"""Server management for Anthropic Server."""

import os
import signal
import subprocess
import time
from pathlib import Path
from typing import Optional

import psutil

from .config import Config


class ServerError(Exception):
    """Server management error."""
    pass


class ServerManager:
    """Manage Anthropic Server process."""

    def __init__(self, config: Config, runtime_dir: Path):
        """Initialize server manager.

        Args:
            config: Configuration object
            runtime_dir: Runtime directory for PID and log files
        """
        self.config = config
        self.runtime_dir = Path(runtime_dir).expanduser()
        self.pid_dir = self.runtime_dir / "run"
        self.log_dir = self.runtime_dir / "logs"

        # Create directories
        self.pid_dir.mkdir(parents=True, exist_ok=True)
        self.log_dir.mkdir(parents=True, exist_ok=True)

        # PID file paths
        self.anthropic_pid_file = self.pid_dir / "anthropic-server.pid"

        # Log file paths
        self.anthropic_log_file = self.log_dir / "anthropic-server.log"

        # Get sprite-claude packages directory
        self.packages_dir = Path(__file__).parent.parent.parent / "packages"

    def start_server(self) -> int:
        """Start Anthropic Server.

        Returns:
            Process ID

        Raises:
            ServerError: If server cannot be started
        """
        if self.is_server_running():
            raise ServerError("Anthropic server is already running")

        # Build command
        port = self.config.get('server.port', 4000)
        host = self.config.get('server.host', '0.0.0.0')

        # Use pnpm to run anthropic-server from packages directory
        anthropic_server_dir = self.packages_dir / "anthropic-server"

        cmd = [
            'pnpm',
            '--dir', str(anthropic_server_dir),
            'start',
            '--port', str(port),
            '--host', host,
        ]

        # Pass config directory to TypeScript server
        # TypeScript will read config.yaml from this directory and resolve prompts relative to it
        cmd.extend(['--config-dir', str(self.config.config_path.parent)])

        # Prepare environment variables
        env = os.environ.copy()

        # Start process
        try:
            log_file = open(self.anthropic_log_file, 'w')
            process = subprocess.Popen(
                cmd,
                stdout=log_file,
                stderr=subprocess.STDOUT,
                env=env,
                start_new_session=True
            )
            # Don't close log_file - let the process keep writing to it
        except FileNotFoundError:
            raise ServerError("pnpm command not found or anthropic-server not built")
        except Exception as e:
            raise ServerError(f"Failed to start Anthropic server: {e}")

        # Write PID file
        self._write_pid_file(self.anthropic_pid_file, process.pid)

        # Wait for server to be ready (longer timeout for model loading)
        print(f"Waiting for Anthropic server on port {port}...")
        if not self._wait_for_port(port, timeout=120):
            self.stop_server()
            raise ServerError(f"Anthropic server did not start successfully on port {port}")
        print(f"Anthropic server is ready on port {port}")

        return process.pid

    def stop_server(self) -> None:
        """Stop Anthropic server.

        Raises:
            ServerError: If server cannot be stopped
        """
        pid = self._read_pid_file(self.anthropic_pid_file)

        # Clean up stale PID file if process is not running
        if pid is not None and not self._is_process_running(pid):
            self._remove_pid_file(self.anthropic_pid_file)
            pid = None

        if pid is None:
            # Try to find anthropic-server process by name
            pid = self._find_anthropic_server_pid()
            if pid is None:
                return

        # Terminate process tree (children first)
        port = self.config.get('server.port', 4000)
        self._terminate_process_tree(pid, "Anthropic server")
        self._remove_pid_file(self.anthropic_pid_file)

        # Wait for port to be released
        print(f"Waiting for port {port} to be released...")
        if not self._wait_for_port_release(port, timeout=10):
            print(f"Warning: Port {port} may still be in use")

    def is_server_running(self) -> bool:
        """Check if Anthropic server is running.

        Returns:
            True if running, False otherwise
        """
        pid = self._read_pid_file(self.anthropic_pid_file)
        if pid is None:
            return False

        return self._is_process_running(pid)

    def stop_all(self) -> None:
        """Stop all servers."""
        self.stop_server()

    def get_status(self) -> dict:
        """Get status of all servers.

        Returns:
            Dictionary with server status
        """
        return {
            'anthropic-server': {
                'running': self.is_server_running(),
                'pid': self._read_pid_file(self.anthropic_pid_file),
                'port': self.config.get('server.port', 4000),
                'model': self.config.get('mlx.model'),
            }
        }

    # Helper methods

    def _write_pid_file(self, pid_file: Path, pid: int) -> None:
        """Write PID to file."""
        try:
            with open(pid_file, 'w') as f:
                f.write(str(pid))
        except IOError as e:
            raise ServerError(f"Cannot write PID file: {e}")

    def _read_pid_file(self, pid_file: Path) -> Optional[int]:
        """Read PID from file.

        Returns:
            PID if file exists and is valid, None otherwise
        """
        if not pid_file.exists():
            return None

        try:
            with open(pid_file, 'r') as f:
                return int(f.read().strip())
        except (IOError, ValueError):
            return None

    def _remove_pid_file(self, pid_file: Path) -> None:
        """Remove PID file."""
        if pid_file.exists():
            pid_file.unlink()

    def _is_process_running(self, pid: int) -> bool:
        """Check if process is running.

        Args:
            pid: Process ID

        Returns:
            True if process exists, False otherwise
        """
        try:
            process = psutil.Process(pid)
            return process.is_running()
        except psutil.NoSuchProcess:
            return False

    def _find_anthropic_server_pid(self) -> Optional[int]:
        """Find anthropic-server process by command line.

        Returns:
            PID if found, None otherwise
        """
        for proc in psutil.process_iter(['pid', 'cmdline']):
            try:
                cmdline = proc.info['cmdline']
                if cmdline and 'anthropic-server' in ' '.join(cmdline):
                    return proc.info['pid']
            except (psutil.NoSuchProcess, psutil.AccessDenied):
                continue
        return None

    def _terminate_process(self, pid: int, name: str) -> None:
        """Terminate process gracefully.

        Args:
            pid: Process ID
            name: Process name for error messages

        Raises:
            ServerError: If process cannot be terminated
        """
        try:
            process = psutil.Process(pid)

            # Try graceful termination first
            process.terminate()

            # Wait for process to terminate
            try:
                process.wait(timeout=5)
            except psutil.TimeoutExpired:
                # Force kill if termination timeout
                process.kill()
                process.wait(timeout=5)

        except psutil.NoSuchProcess:
            # Process already terminated
            pass
        except Exception as e:
            raise ServerError(f"Failed to stop {name}: {e}")

    def _terminate_process_tree(self, pid: int, name: str) -> None:
        """Terminate process tree gracefully (children first).

        Args:
            pid: Parent process ID
            name: Process name for error messages

        Raises:
            ServerError: If process cannot be terminated
        """
        try:
            parent = psutil.Process(pid)
            children = parent.children(recursive=True)

            # Terminate children first (gracefully)
            for child in children:
                try:
                    child.terminate()
                except psutil.NoSuchProcess:
                    pass

            # Wait for children to terminate
            gone, alive = psutil.wait_procs(children, timeout=5)

            # Force kill remaining children
            for child in alive:
                try:
                    child.kill()
                except psutil.NoSuchProcess:
                    pass

            # Now terminate parent
            try:
                parent.terminate()
                parent.wait(timeout=5)
            except psutil.TimeoutExpired:
                parent.kill()
                parent.wait(timeout=5)

        except psutil.NoSuchProcess:
            # Process already terminated
            pass
        except Exception as e:
            raise ServerError(f"Failed to stop {name}: {e}")

    def _wait_for_port_release(self, port: int, host: str = 'localhost', timeout: int = 10) -> bool:
        """Wait for port to be released.

        Args:
            port: Port number
            host: Host address
            timeout: Timeout in seconds

        Returns:
            True if port is released, False if timeout
        """
        import socket

        start_time = time.time()
        while time.time() - start_time < timeout:
            # Check if port is closed (not listening)
            try:
                sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
                sock.settimeout(1)
                result = sock.connect_ex((host, port))
                sock.close()

                if result != 0:
                    # Port is closed
                    return True
            except (socket.error, OSError):
                # Port is closed
                return True

            time.sleep(0.5)

        return False

    def _health_check(self, port: int, host: str = 'localhost') -> bool:
        """Perform health check on the server.

        Args:
            port: Port number
            host: Host address

        Returns:
            True if server is healthy, False otherwise
        """
        import socket
        import http.client

        try:
            # Try to connect and make a simple request
            conn = http.client.HTTPConnection(host, port, timeout=5)
            conn.request("GET", "/v1/models")
            response = conn.getresponse()
            conn.close()

            # Accept any response (even errors) as long as server responds
            return response.status in [200, 404, 500]
        except Exception:
            return False

    def _wait_for_port(self, port: int, host: str = 'localhost', timeout: int = 30) -> bool:
        """Wait for port to be available and responding.

        Args:
            port: Port number
            host: Host address
            timeout: Timeout in seconds

        Returns:
            True if port is available and responding, False if timeout
        """
        import socket

        start_time = time.time()
        attempts = 0
        port_ready = False

        while time.time() - start_time < timeout:
            attempts += 1

            # Try both IPv4 and IPv6
            for family, family_name in [(socket.AF_INET, 'IPv4'), (socket.AF_INET6, 'IPv6')]:
                try:
                    # Check if port is listening and accepting connections
                    sock = socket.socket(family, socket.SOCK_STREAM)
                    sock.settimeout(2)
                    result = sock.connect_ex((host, port))
                    sock.close()

                    if result == 0:
                        # Port is open
                        if not port_ready:
                            print(f"  Port {port} is ready on {family_name} (attempt {attempts})")
                            port_ready = True

                        # Perform health check
                        if self._health_check(port, host):
                            print(f"  Server health check passed")
                            return True
                        else:
                            print(f"  Port is open but health check failed, retrying...")

                except (socket.error, OSError) as e:
                    # IPv6 might not be available, that's ok
                    pass

            time.sleep(0.5)

        print(f"  Timeout waiting for port {port} after {attempts} attempts")
        return False
