"""Integration test for nympish-claude with Claude Code."""

import os
import subprocess
import sys
from pathlib import Path


def test_nympish_claude_prompt():
    """Test nympish-claude by passing a prompt directly to Claude Code."""

    # Get project directory
    project_dir = Path(__file__).parent.parent

    # Simple test prompt
    test_prompt = "こんにちは。簡単に自己紹介してください。"

    print("=" * 60)
    print("nympish-claude Integration Test")
    print("=" * 60)
    print(f"Test prompt: {test_prompt}")
    print()

    # Create a test script that launches Claude Code with the prompt
    test_script = f"""
import os
import sys
import subprocess
from pathlib import Path

# Import nympish-claude modules
sys.path.insert(0, str(Path('{project_dir}') / 'src'))
from nympish_claude.config import Config
from nympish_claude.server import ServerManager

# Configuration
config_path = Path.home() / ".nympish-claude" / "config.yaml"
runtime_dir = Path.home() / ".nympish-claude"

# Load configuration
config = Config(config_path)
config.load()

# Prepare environment variables
env = os.environ.copy()

# Choose connection endpoint based on use_omni_server setting
use_omni_server = config.get('mlx.use_omni_server', False)
if use_omni_server:
    # Connect directly to mlx-omni-server's Anthropic endpoint
    env['ANTHROPIC_BASE_URL'] = f"http://localhost:{{config.get('mlx.port', 58080)}}/anthropic"
    env['ANTHROPIC_AUTH_TOKEN'] = "dummy"
    print(f"Using mlx-omni-server directly (port {{config.get('mlx.port', 58080)}})")
else:
    # Connect via LiteLLM proxy
    env['ANTHROPIC_BASE_URL'] = f"http://localhost:{{config.get('litellm.port', 4000)}}"
    env['ANTHROPIC_AUTH_TOKEN'] = config.get('litellm.master_key', 'sk-LITELLM_VIRTUAL_KEY')
    print(f"Using LiteLLM proxy (port {{config.get('litellm.port', 4000)}})")

# Set default model
if config.get('model_mapping'):
    first_model = config.get('model_mapping')[0]['claude_model']
    env['ANTHROPIC_DEFAULT_MODEL'] = first_model
    print(f"Using model: {{first_model}}")

# Disable Vertex AI
env.pop('CLAUDE_CODE_USE_VERTEX', None)
env.pop('ANTHROPIC_VERTEX_PROJECT_ID', None)

print()
print("Launching Claude Code...")
print("=" * 60)

# Launch claude command with the test prompt
try:
    result = subprocess.run(
        ['claude', '{test_prompt}'],
        env=env,
        capture_output=False,
        text=True
    )
    sys.exit(result.returncode)
except FileNotFoundError:
    print("Error: 'claude' command not found. Please install Claude Code.", file=sys.stderr)
    sys.exit(1)
"""

    # Write test script to temporary file
    test_script_path = project_dir / "tests" / "_test_runner.py"
    with open(test_script_path, 'w') as f:
        f.write(test_script)

    try:
        # Run the test script
        result = subprocess.run(
            ['uv', 'run', '--project', str(project_dir), 'python', str(test_script_path)],
            capture_output=False,
            text=True
        )

        print()
        print("=" * 60)
        if result.returncode == 0:
            print("✓ Test completed successfully")
        else:
            print(f"✗ Test failed with return code: {result.returncode}")
        print("=" * 60)

        return result.returncode == 0

    finally:
        # Clean up test script
        if test_script_path.exists():
            test_script_path.unlink()


if __name__ == "__main__":
    success = test_nympish_claude_prompt()
    sys.exit(0 if success else 1)
