"""Tests for config module."""

import pytest
from pathlib import Path
import tempfile
import yaml

from nympish_claude.config import Config, ConfigError


@pytest.fixture
def test_config_path():
    """Test configuration file path."""
    return Path(__file__).parent / "fixtures" / "test_config.yaml"


@pytest.fixture
def temp_config_file():
    """Create a temporary configuration file."""
    with tempfile.NamedTemporaryFile(mode='w', suffix='.yaml', delete=False) as f:
        config_data = {
            "mlx": {"model": "test-model", "port": 8080},
            "litellm": {"port": 4000},
            "system_prompt": {
                "default": "Default prompt",
            },
        }
        yaml.dump(config_data, f)
        temp_path = Path(f.name)

    yield temp_path

    # Cleanup
    if temp_path.exists():
        temp_path.unlink()


@pytest.fixture
def temp_prompt_file():
    """Create a temporary prompt file."""
    with tempfile.NamedTemporaryFile(mode='w', suffix='.md', delete=False) as f:
        f.write("This is a test prompt from file.")
        temp_path = Path(f.name)

    yield temp_path

    # Cleanup
    if temp_path.exists():
        temp_path.unlink()


class TestConfig:
    """Test Config class."""

    def test_load_config(self, test_config_path):
        """Test loading configuration file."""
        config = Config(test_config_path)
        config.load()

        assert config.get('mlx.model') == "mlx-community/Meta-Llama-3-8B-Instruct-4bit"
        assert config.get('mlx.port') == 8080
        assert config.get('litellm.port') == 4000

    def test_load_nonexistent_config(self):
        """Test loading non-existent configuration file."""
        config = Config(Path("/nonexistent/config.yaml"))

        with pytest.raises(ConfigError, match="Configuration file not found"):
            config.load()

    def test_get_nested_value(self, test_config_path):
        """Test getting nested configuration value."""
        config = Config(test_config_path)
        config.load()

        assert config.get('mlx.host') == "localhost"
        assert config.get('litellm.master_key') == "sk-TEST-KEY"

    def test_get_with_default(self, test_config_path):
        """Test getting value with default."""
        config = Config(test_config_path)
        config.load()

        assert config.get('nonexistent.key', 'default_value') == 'default_value'

    def test_expand_path(self, test_config_path):
        """Test path expansion."""
        config = Config(test_config_path)

        expanded = config.expand_path("~/test/path")
        assert expanded == Path.home() / "test" / "path"

    def test_create_default_config(self):
        """Test creating default configuration file."""
        with tempfile.TemporaryDirectory() as tmpdir:
            config_path = Path(tmpdir) / "test_config.yaml"

            Config.create_default_config(config_path)

            assert config_path.exists()

            # Verify content
            config = Config(config_path)
            config.load()
            assert config.get('mlx.model') == Config.DEFAULT_CONFIG['mlx']['model']

    def test_create_default_config_already_exists(self, temp_config_file):
        """Test creating default config when file already exists."""
        with pytest.raises(ConfigError, match="Configuration file already exists"):
            Config.create_default_config(temp_config_file)
