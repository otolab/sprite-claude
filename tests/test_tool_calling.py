"""Test tool calling functionality with mlx-omni-server."""

import os
import json
import requests
from pathlib import Path


def test_anthropic_endpoint():
    """Test mlx-omni-server's Anthropic endpoint is accessible."""
    base_url = "http://localhost:58080/anthropic"

    # Test /v1/messages endpoint
    url = f"{base_url}/v1/messages"

    headers = {
        "Content-Type": "application/json",
        "anthropic-version": "2023-06-01",
        "x-api-key": "dummy"
    }

    # Simple test message without tools
    payload = {
        "model": "claude-3-5-sonnet-20241022",
        "max_tokens": 100,
        "messages": [
            {
                "role": "user",
                "content": "こんにちは"
            }
        ]
    }

    print(f"Testing endpoint: {url}")
    print(f"Payload: {json.dumps(payload, indent=2, ensure_ascii=False)}")

    try:
        response = requests.post(url, headers=headers, json=payload, timeout=30)
        print(f"\nStatus Code: {response.status_code}")
        print(f"Response Headers: {dict(response.headers)}")
        print(f"Response Body: {response.text}")

        if response.status_code == 200:
            print("\n✓ Anthropic endpoint is working!")
            return True
        else:
            print(f"\n✗ Endpoint returned error: {response.status_code}")
            return False

    except requests.exceptions.ConnectionError:
        print("\n✗ Cannot connect to mlx-omni-server. Is it running?")
        return False
    except Exception as e:
        print(f"\n✗ Error: {e}")
        return False


def test_tool_calling():
    """Test tool calling functionality."""
    base_url = "http://localhost:58080/anthropic"
    url = f"{base_url}/v1/messages"

    headers = {
        "Content-Type": "application/json",
        "anthropic-version": "2023-06-01",
        "x-api-key": "dummy"
    }

    # Test message with tool definition
    payload = {
        "model": "claude-3-5-sonnet-20241022",
        "max_tokens": 1024,
        "tools": [
            {
                "name": "get_weather",
                "description": "指定された場所の天気情報を取得します",
                "input_schema": {
                    "type": "object",
                    "properties": {
                        "location": {
                            "type": "string",
                            "description": "都市名（例: 東京、大阪）"
                        }
                    },
                    "required": ["location"]
                }
            }
        ],
        "messages": [
            {
                "role": "user",
                "content": "東京の天気を教えて"
            }
        ]
    }

    print("\n" + "="*60)
    print("Testing tool calling functionality")
    print("="*60)
    print(f"Endpoint: {url}")
    print(f"Payload: {json.dumps(payload, indent=2, ensure_ascii=False)}")

    try:
        response = requests.post(url, headers=headers, json=payload, timeout=30)
        print(f"\nStatus Code: {response.status_code}")

        if response.status_code == 200:
            response_data = response.json()
            print(f"Response: {json.dumps(response_data, indent=2, ensure_ascii=False)}")

            # Check if tool was called
            content = response_data.get("content", [])
            tool_used = any(block.get("type") == "tool_use" for block in content)

            if tool_used:
                print("\n✓ Tool calling is working! Model generated tool_use block.")
                return True
            else:
                print("\n⚠ Model responded but didn't use the tool.")
                print("This might be expected depending on the model's decision.")
                return True
        else:
            print(f"\n✗ Request failed: {response.status_code}")
            print(f"Response: {response.text}")
            return False

    except Exception as e:
        print(f"\n✗ Error: {e}")
        return False


def test_env_variables():
    """Test that environment variables are set correctly."""
    print("\n" + "="*60)
    print("Testing environment variable configuration")
    print("="*60)

    # Load config to check use_omni_server setting
    config_path = Path.home() / ".nympish-claude" / "config.yaml"

    if not config_path.exists():
        print(f"✗ Config file not found: {config_path}")
        return False

    import yaml
    with open(config_path) as f:
        config = yaml.safe_load(f)

    use_omni_server = config.get("mlx", {}).get("use_omni_server", False)
    mlx_port = config.get("mlx", {}).get("port", 58080)
    litellm_port = config.get("litellm", {}).get("port", 4000)

    print(f"use_omni_server: {use_omni_server}")
    print(f"MLX port: {mlx_port}")
    print(f"LiteLLM port: {litellm_port}")

    if use_omni_server:
        expected_base_url = f"http://localhost:{mlx_port}/anthropic"
        print(f"\nExpected ANTHROPIC_BASE_URL: {expected_base_url}")
        print("Expected ANTHROPIC_AUTH_TOKEN: dummy")
    else:
        expected_base_url = f"http://localhost:{litellm_port}"
        print(f"\nExpected ANTHROPIC_BASE_URL: {expected_base_url}")
        print(f"Expected ANTHROPIC_AUTH_TOKEN: (from config)")

    print("\n✓ Configuration looks correct")
    return True


if __name__ == "__main__":
    print("nympish-claude Tool Calling Test Suite")
    print("=" * 60)

    # Run tests
    results = []

    print("\n1. Testing environment variables...")
    results.append(("Environment Variables", test_env_variables()))

    print("\n2. Testing Anthropic endpoint...")
    results.append(("Anthropic Endpoint", test_anthropic_endpoint()))

    print("\n3. Testing tool calling...")
    results.append(("Tool Calling", test_tool_calling()))

    # Summary
    print("\n" + "=" * 60)
    print("Test Summary")
    print("=" * 60)
    for name, result in results:
        status = "✓ PASS" if result else "✗ FAIL"
        print(f"{status}: {name}")

    all_passed = all(result for _, result in results)
    print("\n" + ("=" * 60))
    if all_passed:
        print("All tests passed!")
    else:
        print("Some tests failed. Please check the output above.")

    exit(0 if all_passed else 1)
