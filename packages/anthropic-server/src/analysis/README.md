# Analysis Directory

This directory contains code related to the analysis of the anthropic-server. It includes various scripts and modules used for analyzing performance, logs, and other aspects of the server.

## Files

- `analysis.py`: Main script for performing analysis tasks.
- `log_analyzer.py`: Module for analyzing server logs.\- `performance_monitor.py`: Module for monitoring server performance.
- `utils.py`: Utility functions used across the analysis directory.


## Tool Usage

### extract-log CLI

This script allows you to navigate and analyze server request logs. Here are some common commands:

- **View session summary**: Lists all requests in a session.
  - 
- **Show request details**: Displays details of a specific request (entries, messages, raw values).
  - 
- **List phase types**: Shows available phase types for filtering.
  - 
- **View server logs**: Displays server lifecycle logs.
  - 

**Examples:**

- List all requests from the latest session:
  

- Show details of request with seqId '0014':
  

- Extract the text content of the first message in request '0014':
  

- Show prompt content for the 'agentic' phase in request '0014':
  

