"""Command-line interface for sprite-claude."""

import os
import sys
import argparse
from pathlib import Path

from .config import Config, ConfigError
from .server import ServerManager, ServerError


DEFAULT_CONFIG_DIR = Path.home() / ".sprite-claude"
DEFAULT_CONFIG_PATH = DEFAULT_CONFIG_DIR / "config.yaml"


def cmd_launch(args):
    """Launch Claude Code with local LLM (default behavior)."""
    config_path = args.config or DEFAULT_CONFIG_PATH
    runtime_dir = args.runtime_dir or DEFAULT_CONFIG_DIR

    try:
        # Auto-initialize config if not exists
        if not config_path.exists():
            print("Configuration file not found. Creating default configuration...")
            Config.create_default_config(config_path)
            print(f"✓ Created: {config_path}\n")

        # Load configuration
        config = Config(config_path)
        config.load()

        # Initialize server manager
        manager = ServerManager(config, runtime_dir)

        # Check server status and start if needed
        status = manager.get_status()

        if not status['anthropic-server']['running']:
            print("Starting Anthropic server...")
            server_pid = manager.start_server()
            print(f"✓ Anthropic server started")
            print()
        else:
            print("✓ Server is already running")

        # Set environment variables and launch Claude Code
        print("Launching Claude Code with local LLM...")

        env = os.environ.copy()

        # Set Claude Code configuration directory to ~/.sprite-claude
        # This ensures Claude Code uses a separate configuration from the default ~/.claude
        claude_config_dir = str(DEFAULT_CONFIG_DIR.resolve())
        env['CLAUDE_CONFIG_DIR'] = claude_config_dir

        # Connect to anthropic-server
        port = config.get('server.port', 4000)
        env['ANTHROPIC_BASE_URL'] = f"http://localhost:{port}"
        env['ANTHROPIC_AUTH_TOKEN'] = "dummy"  # Not required for local server
        print(f"Using Anthropic server (port {port})")
        print(f"Using Claude config directory: {claude_config_dir}")

        # Set default model (can be any Claude model name, will be mapped to MLX)
        env['ANTHROPIC_MODEL'] = 'claude-3-5-sonnet-20241022'

        # Disable Vertex AI to ensure local LLM is used
        env.pop('CLAUDE_CODE_USE_VERTEX', None)
        env.pop('ANTHROPIC_VERTEX_PROJECT_ID', None)

        # Build disallowed tools list from config
        disallowed_tools = config.get('tools.excludes', [])

        # Launch claude command with any additional arguments
        import subprocess
        try:
            claude_args = ['claude']

            # Restore settings and plugins from .sprite-claude
            settings_path = Path(claude_config_dir) / 'settings.json'
            if settings_path.exists():
                claude_args.extend(['--settings', str(settings_path)])
            plugins_path = Path(claude_config_dir) / 'plugins'
            if plugins_path.exists():
                claude_args.extend(['--plugin-dir', str(plugins_path)])

            # Add --disallowedTools from config
            if disallowed_tools:
                claude_args.append('--disallowedTools')
                claude_args.extend(disallowed_tools)

            claude_args.extend(args.claude_args)
            result = subprocess.run(claude_args, env=env)
            return result.returncode
        except FileNotFoundError:
            print("Error: 'claude' command not found. Please install Claude Code.", file=sys.stderr)
            return 1

    except (ConfigError, ServerError) as e:
        print(f"Error: {e}", file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        print("\nInterrupted", file=sys.stderr)
        return 130


def cmd_init(args):
    """Initialize configuration file."""
    config_path = args.config or DEFAULT_CONFIG_PATH

    try:
        Config.create_default_config(config_path)
        print(f"Created default configuration: {config_path}")
        print("\nPlease edit the configuration file to customize settings.")
        return 0
    except ConfigError as e:
        print(f"Error: {e}", file=sys.stderr)
        return 1


def cmd_start(args):
    """Start servers."""
    config_path = args.config or DEFAULT_CONFIG_PATH
    runtime_dir = args.runtime_dir or DEFAULT_CONFIG_DIR

    try:
        # Load configuration
        config = Config(config_path)
        config.load()
        print(f"Loaded configuration from: {config_path}")

        # Initialize server manager
        manager = ServerManager(config, runtime_dir)

        # Start Anthropic server
        print("\nStarting Anthropic server...")
        server_pid = manager.start_server()
        print(f"Anthropic server started (PID: {server_pid})")

        print("\n✓ Server started successfully!")
        print(f"\nAnthropic Server: http://localhost:{config.get('server.port', 4000)}")
        print(f"Model: {config.get('mlx.model')}")
        print("\nSet these environment variables to use with Claude Code:")
        print(f'  export ANTHROPIC_BASE_URL="http://localhost:{config.get("server.port", 4000)}"')
        print(f'  export ANTHROPIC_AUTH_TOKEN="dummy"')

        return 0

    except (ConfigError, ServerError) as e:
        print(f"Error: {e}", file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        print("\nInterrupted", file=sys.stderr)
        return 130


def cmd_stop(args):
    """Stop servers."""
    config_path = args.config or DEFAULT_CONFIG_PATH
    runtime_dir = args.runtime_dir or DEFAULT_CONFIG_DIR

    try:
        # Load configuration
        config = Config(config_path)
        config.load()

        # Initialize server manager
        manager = ServerManager(config, runtime_dir)

        # Stop servers
        print("Stopping servers...")
        manager.stop_all()
        print("✓ All servers stopped")

        return 0

    except (ConfigError, ServerError) as e:
        print(f"Error: {e}", file=sys.stderr)
        return 1


def cmd_status(args):
    """Show server status."""
    config_path = args.config or DEFAULT_CONFIG_PATH
    runtime_dir = args.runtime_dir or DEFAULT_CONFIG_DIR

    try:
        # Load configuration
        config = Config(config_path)
        config.load()

        # Initialize server manager
        manager = ServerManager(config, runtime_dir)

        # Get status
        status = manager.get_status()

        print("Server Status:\n")

        # Anthropic server status
        server_status = status['anthropic-server']
        server_running = "✓ Running" if server_status['running'] else "✗ Stopped"
        print(f"Anthropic Server: {server_running}")
        if server_status['running']:
            print(f"  PID:   {server_status['pid']}")
            print(f"  Port:  {server_status['port']}")
            print(f"  Model: {server_status['model']}")

        return 0

    except (ConfigError, ServerError) as e:
        print(f"Error: {e}", file=sys.stderr)
        return 1


def cmd_config_edit(args):
    """Edit configuration file."""
    config_path = args.config or DEFAULT_CONFIG_PATH

    if not config_path.exists():
        print(f"Error: Configuration file not found: {config_path}", file=sys.stderr)
        print("Run 'sprite-claude init' to create it first.", file=sys.stderr)
        return 1

    # Open with default editor
    import subprocess
    editor = os.environ.get('EDITOR', 'vi')
    try:
        subprocess.run([editor, str(config_path)])
        return 0
    except Exception as e:
        print(f"Error: Failed to open editor: {e}", file=sys.stderr)
        return 1


def cmd_server_restart(args):
    """Restart servers."""
    # Stop then start
    ret = cmd_stop(args)
    if ret != 0:
        return ret
    return cmd_start(args)


def main():
    """Main entry point."""
    parser = argparse.ArgumentParser(
        description='sprite-claude: Launch Claude Code with local MLX-based LLM',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  sprite-claude              # Launch Claude Code with local LLM
  sprite-claude init         # Initialize configuration file
  sprite-claude server start # Start servers only
  sprite-claude server stop  # Stop servers
"""
    )

    parser.add_argument(
        '--config',
        type=Path,
        help=f'Configuration file path (default: {DEFAULT_CONFIG_PATH})'
    )

    parser.add_argument(
        '--runtime-dir',
        type=Path,
        help=f'Runtime directory for PID/log files (default: {DEFAULT_CONFIG_DIR})'
    )

    subparsers = parser.add_subparsers(dest='command', help='Available commands')

    # init command
    parser_init = subparsers.add_parser('init', help='Initialize configuration file')

    # config command group
    parser_config = subparsers.add_parser('config', help='Configuration management')
    config_subparsers = parser_config.add_subparsers(dest='config_command')
    parser_config_edit = config_subparsers.add_parser('edit', help='Edit configuration file')

    # server command group
    parser_server = subparsers.add_parser('server', help='Server management')
    server_subparsers = parser_server.add_subparsers(dest='server_command')
    parser_server_start = server_subparsers.add_parser('start', help='Start servers')
    parser_server_stop = server_subparsers.add_parser('stop', help='Stop servers')
    parser_server_status = server_subparsers.add_parser('status', help='Show server status')
    parser_server_restart = server_subparsers.add_parser('restart', help='Restart servers')

    # Check if first argument (after --config/--runtime-dir) is a known command
    # If not, treat all args as claude arguments
    argv = sys.argv[1:]

    # Filter out --config and --runtime-dir arguments
    filtered_argv = []
    skip_next = False
    for i, arg in enumerate(argv):
        if skip_next:
            skip_next = False
            continue
        if arg in ['--config', '--runtime-dir']:
            skip_next = True
            continue
        filtered_argv.append(arg)

    # Check if first arg is a known command
    known_commands = ['init', 'config', 'server']
    if filtered_argv and filtered_argv[0] not in known_commands:
        # All arguments are for claude command
        args = parser.parse_args([])  # Parse with no command
        args.command = None
        args.claude_args = argv  # Pass all original args to claude
        return cmd_launch(args)

    # Parse normally for known commands
    args = parser.parse_args()
    args.claude_args = []

    # Default behavior: launch Claude Code
    if not args.command:
        return cmd_launch(args)

    # Execute command
    if args.command == 'init':
        return cmd_init(args)
    elif args.command == 'config':
        if args.config_command == 'edit':
            return cmd_config_edit(args)
        else:
            parser_config.print_help()
            return 1
    elif args.command == 'server':
        server_commands = {
            'start': cmd_start,
            'stop': cmd_stop,
            'status': cmd_status,
            'restart': cmd_server_restart,
        }
        if args.server_command in server_commands:
            return server_commands[args.server_command](args)
        else:
            parser_server.print_help()
            return 1
    else:
        parser.print_help()
        return 1


if __name__ == '__main__':
    sys.exit(main())
