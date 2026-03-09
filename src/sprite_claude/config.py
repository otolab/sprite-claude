"""Configuration file handling for sprite-claude."""

import os
from pathlib import Path
from typing import Any, Dict, Optional

import yaml


class ConfigError(Exception):
    """Configuration error."""
    pass


class Config:
    """Configuration manager for sprite-claude."""

    DEFAULT_CONFIG_PATH = Path.home() / ".sprite-claude.yaml"

    DEFAULT_CONFIG = {
        # Legacy format (for backward compatibility)
        "mlx": {
            "model": "mlx-community/gemma-2-2b-it-4bit",
        },
        # New format (AIService configuration)
        # Uncomment to use multiple models:
        # "models": [
        #     {
        #         "model": "mlx-community/gemma-2-2b-it-4bit",
        #         "provider": "mlx",
        #         "capabilities": ["local", "fast"],
        #         "priority": 10,
        #         "enabled": True,
        #     },
        #     {
        #         "model": "gemini-2.0-flash-001",
        #         "provider": "vertexai",
        #         "capabilities": ["fast", "japanese", "reasoning"],
        #         "priority": 20,
        #         "enabled": True,
        #     },
        # ],
        # "drivers": {
        #     "mlx": {},
        #     "vertexai": {
        #         "project": "your-gcp-project-id",
        #         "location": "us-central1",
        #     },
        # },
        # "selection": {
        #     "preferLocal": True,
        #     "preferFast": True,
        #     "lenient": True,
        #     "requiredCapabilities": [],
        # },
        "server": {
            "port": 4000,
            "host": "0.0.0.0",
        },
        "runtime": {
            "pid_dir": "~/.sprite-claude/run",
            "log_dir": "~/.sprite-claude/logs",
        },
    }

    def __init__(self, config_path: Optional[Path] = None):
        """Initialize configuration.

        Args:
            config_path: Path to configuration file. If None, uses default path.
        """
        self.config_path = config_path or self.DEFAULT_CONFIG_PATH
        self._config: Dict[str, Any] = {}

    def load(self) -> None:
        """Load configuration from file.

        Raises:
            ConfigError: If configuration file cannot be loaded or parsed.
        """
        if not self.config_path.exists():
            raise ConfigError(f"Configuration file not found: {self.config_path}")

        try:
            with open(self.config_path, 'r') as f:
                self._config = yaml.safe_load(f)
        except yaml.YAMLError as e:
            raise ConfigError(f"Invalid YAML in configuration file: {e}")
        except IOError as e:
            raise ConfigError(f"Cannot read configuration file: {e}")

    def get(self, key: str, default: Any = None) -> Any:
        """Get configuration value.

        Args:
            key: Configuration key (supports dot notation, e.g., "mlx.port")
            default: Default value if key not found

        Returns:
            Configuration value
        """
        keys = key.split('.')
        value = self._config

        for k in keys:
            if isinstance(value, dict) and k in value:
                value = value[k]
            else:
                return default

        return value

    def resolve_system_prompt(self, prompt_value: str, base_dir: Optional[Path] = None) -> str:
        """Resolve system prompt value.

        If prompt_value starts with '@', treat it as a file reference and load the file.

        Args:
            prompt_value: Prompt value or file reference (e.g., "@prompts/xxx.md")
            base_dir: Base directory for resolving relative paths. If None, uses config file directory.

        Returns:
            Resolved prompt content

        Raises:
            ConfigError: If file reference cannot be resolved
        """
        if not prompt_value.startswith('@'):
            return prompt_value

        # Remove '@' prefix
        file_path = prompt_value[1:]

        # Resolve base directory
        if base_dir is None:
            base_dir = self.config_path.parent

        # Resolve file path
        prompt_file = Path(file_path)
        if not prompt_file.is_absolute():
            prompt_file = base_dir / prompt_file

        # Expand user home directory
        prompt_file = prompt_file.expanduser()

        # Read file
        if not prompt_file.exists():
            raise ConfigError(f"System prompt file not found: {prompt_file}")

        try:
            with open(prompt_file, 'r') as f:
                return f.read().strip()
        except IOError as e:
            raise ConfigError(f"Cannot read system prompt file: {e}")

    def get_system_prompt(self, model: Optional[str] = None) -> str:
        """Get system prompt for a model.

        Args:
            model: Model name (e.g., "claude-3-opus"). If None, returns default prompt.

        Returns:
            System prompt content
        """
        system_prompt_config = self.get('system_prompt', {})

        # Check model-specific prompt
        if model and 'models' in system_prompt_config:
            model_prompts = system_prompt_config['models']
            if model in model_prompts:
                prompt_value = model_prompts[model]
                return self.resolve_system_prompt(prompt_value)

        # Use default prompt
        default_prompt = system_prompt_config.get('default', self.DEFAULT_CONFIG['system_prompt']['default'])
        return self.resolve_system_prompt(default_prompt)

    def expand_path(self, path: str) -> Path:
        """Expand path with user home directory.

        Args:
            path: Path string

        Returns:
            Expanded Path object
        """
        return Path(path).expanduser()

    @classmethod
    def create_default_config(cls, config_path: Optional[Path] = None) -> None:
        """Create default configuration file.

        Args:
            config_path: Path to create configuration file. If None, uses default path.

        Raises:
            ConfigError: If configuration file cannot be created
        """
        path = config_path or cls.DEFAULT_CONFIG_PATH

        if path.exists():
            raise ConfigError(f"Configuration file already exists: {path}")

        # Create parent directory if not exists
        path.parent.mkdir(parents=True, exist_ok=True)

        try:
            with open(path, 'w') as f:
                yaml.dump(cls.DEFAULT_CONFIG, f, default_flow_style=False, sort_keys=False)
        except IOError as e:
            raise ConfigError(f"Cannot create configuration file: {e}")
