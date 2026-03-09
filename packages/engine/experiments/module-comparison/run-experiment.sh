#!/bin/bash
# Wrapper script for running module comparison experiments
# Usage: ./run-experiment.sh [options]

# Get the directory of this script
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

# Go to engine directory where node_modules is located
cd "$SCRIPT_DIR/../.."

# Run the experiment using the installed @modular-prompt/experiment package
npx tsx node_modules/@modular-prompt/experiment/dist/run-comparison.js \
  "$SCRIPT_DIR/configs/experiment.yaml" \
  "$@"
