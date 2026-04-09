# Amazon Connect Copy — Web UI

A browser-based interface for exporting and restoring Amazon Connect instance components.

Wraps the same logic as the original `connect_save` / `connect_diff` / `connect_copy` shell scripts into a point-and-click web app.

## Quick Start

```bash
npm install
npm start
```

Open [http://localhost:3000](http://localhost:3000)

## Prerequisites

- Node.js 18+
- AWS CLI credentials configured (`~/.aws/credentials`) with a profile that has [Connect permissions](README.md#useful-tips)

## Usage

### Export (Save)

1. Select your AWS profile and region (or click **Scan All Regions** to find your instance)
2. Select an instance from the dropdown
3. Click **Fetch Components**
4. Check the components you want to export
5. Click **Download as JSON** to save locally

### Import (Restore)

1. Upload a previously exported JSON file
2. Select the destination instance (profile + region)
3. Check which components to restore
4. Click **Restore to Destination**

## Supported Components

- Prompts (list only — upload must be done manually)
- Hours of Operations
- Queues (STANDARD)
- Routing Profiles
- Contact Flow Modules
- Contact Flows
- Lambda function associations

## Project Structure

```
ui/
  server.js          Express API server (AWS SDK v3)
  public/
    index.html       Frontend UI
    app.js           Frontend logic
bin/
  connect_save       Original shell script (save)
  connect_diff       Original shell script (diff)
  connect_copy       Original shell script (copy)
```
