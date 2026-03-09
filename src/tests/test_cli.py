"""Tests for CLI module."""

import pytest
from pathlib import Path
import tempfile
from unittest.mock import patch, MagicMock

from nympish_claude.cli import (
    cmd_init,
    cmd_config_edit,
    main,
    DEFAULT_CONFIG_PATH,
    DEFAULT_CONFIG_DIR,
)


class TestCmdInit:
    """Test cmd_init function."""

    def test_init_creates_config(self, tmp_path):
        """Test initializing configuration file."""
        config_path = tmp_path / "config.yaml"

        # Mock args
        args = MagicMock()
        args.config = config_path

        # Execute
        ret = cmd_init(args)

        assert ret == 0
        assert config_path.exists()


class TestDefaultPaths:
    """Test default path configuration."""

    def test_default_config_dir(self):
        """Test default config directory."""
        assert DEFAULT_CONFIG_DIR == Path.home() / ".nympish-claude"

    def test_default_config_path(self):
        """Test default config file path."""
        assert DEFAULT_CONFIG_PATH == Path.home() / ".nympish-claude" / "config.yaml"


class TestMain:
    """Test main entry point."""

    @patch('nympish_claude.cli.cmd_launch')
    @patch('sys.argv', ['nympish-claude'])
    def test_main_no_args_launches_claude(self, mock_launch):
        """Test main with no arguments launches Claude Code."""
        mock_launch.return_value = 0

        ret = main()

        assert ret == 0
        mock_launch.assert_called_once()

    @patch('nympish_claude.cli.cmd_init')
    @patch('sys.argv', ['nympish-claude', 'init'])
    def test_main_init_command(self, mock_init):
        """Test main with init command."""
        mock_init.return_value = 0

        ret = main()

        assert ret == 0
        mock_init.assert_called_once()

    @patch('nympish_claude.cli.cmd_start')
    @patch('sys.argv', ['nympish-claude', 'server', 'start'])
    def test_main_server_start_command(self, mock_start):
        """Test main with server start command."""
        mock_start.return_value = 0

        ret = main()

        assert ret == 0
        mock_start.assert_called_once()

    @patch('nympish_claude.cli.cmd_stop')
    @patch('sys.argv', ['nympish-claude', 'server', 'stop'])
    def test_main_server_stop_command(self, mock_stop):
        """Test main with server stop command."""
        mock_stop.return_value = 0

        ret = main()

        assert ret == 0
        mock_stop.assert_called_once()

    @patch('nympish_claude.cli.cmd_status')
    @patch('sys.argv', ['nympish-claude', 'server', 'status'])
    def test_main_server_status_command(self, mock_status):
        """Test main with server status command."""
        mock_status.return_value = 0

        ret = main()

        assert ret == 0
        mock_status.assert_called_once()
