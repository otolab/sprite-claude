"""KV cache management for sprite-claude."""

import json
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


class CacheError(Exception):
    pass


class _IndexLock:
    """proper-lockfile互換のmkdirベースアドバイザリロック。"""

    def __init__(self, index_path: Path, retries: int = 3, interval: float = 0.2):
        self.lock_path = Path(str(index_path) + ".lock")
        self.retries = retries
        self.interval = interval

    def __enter__(self):
        for attempt in range(self.retries + 1):
            try:
                self.lock_path.mkdir()
                return self
            except FileExistsError:
                if attempt == self.retries:
                    # stale lock detection: 60秒以上前のロックは強制解除
                    try:
                        age = time.time() - self.lock_path.stat().st_mtime
                        if age > 60:
                            self.lock_path.rmdir()
                            self.lock_path.mkdir()
                            return self
                    except OSError:
                        pass
                    raise CacheError(
                        f"Cannot acquire lock: {self.lock_path} "
                        "(server running? try again later)"
                    )
                time.sleep(self.interval)
        return self

    def __exit__(self, *_args):
        try:
            self.lock_path.rmdir()
        except OSError:
            pass


class CacheManager:
    """cache-index.jsonを使ったKVキャッシュの管理。"""

    DEFAULT_CACHE_DIR = Path.home() / ".sprite-claude" / "cache"

    def __init__(self, cache_dir: Path | None = None):
        self.cache_dir = cache_dir or self.DEFAULT_CACHE_DIR
        self.index_path = self.cache_dir / "cache-index.json"

    def load_index(self) -> dict[str, Any]:
        if not self.index_path.exists():
            return {"version": 1, "entries": []}
        with _IndexLock(self.index_path):
            raw = self.index_path.read_text("utf-8")
            parsed = json.loads(raw)
            if parsed.get("version") == 1 and isinstance(parsed.get("entries"), list):
                return parsed
            return {"version": 1, "entries": []}

    def save_index(self, index: dict[str, Any]) -> None:
        with _IndexLock(self.index_path):
            self.index_path.write_text(json.dumps(index, indent=2), "utf-8")

    def _entry_path(self, key: str) -> Path:
        return self.cache_dir / f"{key}.safetensors"

    def _entry_size(self, key: str) -> int:
        path = self._entry_path(key)
        try:
            return path.stat().st_size
        except OSError:
            return 0

    def show(self) -> dict[str, Any]:
        """キャッシュ状態のサマリーを返す。"""
        if not self.cache_dir.exists():
            return {
                "cache_dir": str(self.cache_dir),
                "entry_count": 0,
                "total_size_mb": 0.0,
                "total_size_gb": 0.0,
                "entries": [],
            }

        index = self.load_index()
        entries_info = []
        total_size = 0
        for entry in index["entries"]:
            size = self._entry_size(entry["key"])
            total_size += size
            entries_info.append({
                "key": entry["key"][:12] + "...",
                "model": entry.get("model", "unknown"),
                "created_at": entry.get("createdAt", "unknown"),
                "size_mb": round(size / (1024 * 1024), 1),
                "hint": entry.get("hint", "retain"),
                "elements": len(entry.get("elementHashes", [])),
            })

        return {
            "cache_dir": str(self.cache_dir),
            "entry_count": len(entries_info),
            "total_size_mb": round(total_size / (1024 * 1024), 1),
            "total_size_gb": round(total_size / (1024 ** 3), 2),
            "entries": entries_info,
        }

    def clean(
        self,
        max_age_days: int = 7,
        max_size_gb: float = 5.0,
        dry_run: bool = False,
    ) -> dict[str, Any]:
        """キャッシュクリーンアップ。

        削除優先順:
        1. hint='release' のエントリ
        2. max_age_days より古いエントリ
        3. 残りを新しい順にソートし、max_size_gb を超える分を古い順に削除
        """
        if not self.cache_dir.exists():
            return {"deleted": [], "kept": 0, "freed_mb": 0, "dry_run": dry_run}

        index = self.load_index()
        now = datetime.now(timezone.utc)
        to_delete: list[dict] = []
        to_keep: list[dict] = []

        for entry in index["entries"]:
            # 1. released エントリ
            if entry.get("hint") == "release":
                to_delete.append(entry)
                continue

            # 2. 古すぎるエントリ
            created = entry.get("createdAt")
            if created:
                try:
                    created_dt = datetime.fromisoformat(created.replace("Z", "+00:00"))
                    age_days = (now - created_dt).total_seconds() / 86400
                    if age_days > max_age_days:
                        to_delete.append(entry)
                        continue
                except (ValueError, TypeError):
                    pass

            to_keep.append(entry)

        # 3. 容量ベースの削除（古い順に削除）
        to_keep.sort(
            key=lambda e: e.get("createdAt", ""),
            reverse=True,
        )
        max_size_bytes = int(max_size_gb * (1024 ** 3))
        running_size = 0
        final_keep: list[dict] = []
        for entry in to_keep:
            size = self._entry_size(entry["key"])
            if running_size + size > max_size_bytes:
                to_delete.append(entry)
            else:
                running_size += size
                final_keep.append(entry)

        freed = 0
        deleted_info = []
        for entry in to_delete:
            size = self._entry_size(entry["key"])
            reason = "released" if entry.get("hint") == "release" else "age/size"
            deleted_info.append({
                "key": entry["key"][:12] + "...",
                "model": entry.get("model", "unknown"),
                "size_mb": round(size / (1024 * 1024), 1),
                "reason": reason,
            })
            if not dry_run:
                freed += size
                self._delete_entry(entry["key"])

        if not dry_run and to_delete:
            index["entries"] = final_keep
            self.save_index(index)

        return {
            "deleted": deleted_info,
            "kept": len(final_keep),
            "freed_mb": round(freed / (1024 * 1024), 1),
            "dry_run": dry_run,
        }

    def _delete_entry(self, key: str) -> None:
        for suffix in [".safetensors", ".safetensors.meta.json"]:
            path = self.cache_dir / f"{key}{suffix}"
            try:
                path.unlink()
            except OSError:
                pass

    @classmethod
    def from_config(cls, config) -> "CacheManager":
        """Config からキャッシュディレクトリを特定して CacheManager を生成。"""
        models = config.get("models", [])
        if isinstance(models, list):
            for m in models:
                if isinstance(m, dict):
                    cache_dir = (m.get("driverOptions") or {}).get("cacheDir")
                    if cache_dir:
                        return cls(Path(cache_dir).expanduser())
        return cls()
