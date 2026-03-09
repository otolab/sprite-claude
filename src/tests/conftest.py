"""Shared test fixtures."""

import pytest
from pathlib import Path


@pytest.fixture
def test_config_path():
    """Test configuration file path."""
    return Path(__file__).parent / "fixtures" / "test_config.yaml"
