"""Tests for server module."""

import pytest
from pathlib import Path
import tempfile
import time

from nympish_claude.config import Config
from nympish_claude.server import ServerManager, ServerError


@pytest.fixture
def test_config(test_config_path):
    """Test configuration object."""
    config = Config(test_config_path)
    config.load()
    return config


@pytest.fixture
def temp_runtime_dir():
    """Temporary runtime directory."""
    with tempfile.TemporaryDirectory() as tmpdir:
        yield Path(tmpdir)


class TestServerManager:
    """Test ServerManager class."""

    def test_init(self, test_config, temp_runtime_dir):
        """Test server manager initialization."""
        manager = ServerManager(test_config, temp_runtime_dir)

        assert manager.config == test_config
        assert manager.runtime_dir == temp_runtime_dir
        assert manager.pid_dir == temp_runtime_dir / "run"
        assert manager.log_dir == temp_runtime_dir / "logs"

        # Verify directories were created
        assert manager.pid_dir.exists()
        assert manager.log_dir.exists()

    def test_write_read_pid_file(self, test_config, temp_runtime_dir):
        """Test PID file operations."""
        manager = ServerManager(test_config, temp_runtime_dir)

        pid_file = manager.pid_dir / "test.pid"

        # Write PID
        manager._write_pid_file(pid_file, 12345)
        assert pid_file.exists()

        # Read PID
        pid = manager._read_pid_file(pid_file)
        assert pid == 12345

        # Remove PID file
        manager._remove_pid_file(pid_file)
        assert not pid_file.exists()

    def test_read_nonexistent_pid_file(self, test_config, temp_runtime_dir):
        """Test reading non-existent PID file."""
        manager = ServerManager(test_config, temp_runtime_dir)

        pid_file = manager.pid_dir / "nonexistent.pid"
        pid = manager._read_pid_file(pid_file)

        assert pid is None

    def test_is_process_running(self, test_config, temp_runtime_dir):
        """Test process running check."""
        manager = ServerManager(test_config, temp_runtime_dir)

        # Current process should be running
        import os
        assert manager._is_process_running(os.getpid()) is True

        # Non-existent process
        assert manager._is_process_running(999999) is False

    def test_is_server_running_no_pid_file(self, test_config, temp_runtime_dir):
        """Test server running check when PID file doesn't exist."""
        manager = ServerManager(test_config, temp_runtime_dir)

        assert manager.is_server_running() is False

    def test_get_status(self, test_config, temp_runtime_dir):
        """Test getting server status."""
        manager = ServerManager(test_config, temp_runtime_dir)

        status = manager.get_status()

        assert 'anthropic-server' in status

        # Check server status structure
        assert 'running' in status['anthropic-server']
        assert 'pid' in status['anthropic-server']
        assert 'port' in status['anthropic-server']
        assert 'model' in status['anthropic-server']

        # Verify initial state
        assert status['anthropic-server']['running'] is False

    def test_wait_for_port_timeout(self, test_config, temp_runtime_dir):
        """Test waiting for port with timeout."""
        manager = ServerManager(test_config, temp_runtime_dir)

        # Use a port that's definitely not open
        result = manager._wait_for_port(65534, timeout=1)
        assert result is False

    def test_stop_server_when_not_running(self, test_config, temp_runtime_dir):
        """Test stopping server when it's not running."""
        manager = ServerManager(test_config, temp_runtime_dir)

        # Should not raise an error
        manager.stop_server()

    def test_stop_all(self, test_config, temp_runtime_dir):
        """Test stopping all servers."""
        manager = ServerManager(test_config, temp_runtime_dir)

        # Should not raise an error even when nothing is running
        manager.stop_all()
