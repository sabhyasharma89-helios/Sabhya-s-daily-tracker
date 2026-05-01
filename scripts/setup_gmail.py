#!/usr/bin/env python3
"""
setup_gmail.py
──────────────
One-time helper: runs the Gmail OAuth2 flow and prints the token JSON
that you need to add as the GMAIL_TOKEN GitHub Secret.

Usage:
  1. pip install -r scripts/requirements.txt
  2. Create a Google Cloud project at https://console.cloud.google.com
  3. Enable Gmail API
  4. Create OAuth 2.0 credentials (Desktop application)
  5. Download credentials.json to this directory
  6. Run: python scripts/setup_gmail.py
  7. Copy the printed JSON and add it as GitHub Secret named GMAIL_TOKEN

The token will have offline access (refresh_token) so it never expires.
"""

import json
import sys
import os

try:
    from google_auth_oauthlib.flow import InstalledAppFlow
    from google.auth.transport.requests import Request
    from google.oauth2.credentials import Credentials
except ImportError:
    print("ERROR: Required packages not installed.")
    print("Run: pip install google-auth-oauthlib google-auth-httplib2 google-api-python-client")
    sys.exit(1)

SCOPES = [
    'https://www.googleapis.com/auth/gmail.readonly',
    'https://www.googleapis.com/auth/gmail.metadata'
]

CREDS_FILE = os.path.join(os.path.dirname(__file__), 'credentials.json')

def main():
    if not os.path.exists(CREDS_FILE):
        print(f"ERROR: credentials.json not found at {CREDS_FILE}")
        print("\nSteps to get credentials.json:")
        print("  1. Go to https://console.cloud.google.com")
        print("  2. Create a project → Enable Gmail API")
        print("  3. APIs & Services → Credentials → Create Credentials → OAuth client ID")
        print("  4. Application type: Desktop app")
        print("  5. Download JSON → rename to credentials.json → place in scripts/ folder")
        sys.exit(1)

    flow = InstalledAppFlow.from_client_secrets_file(CREDS_FILE, SCOPES)
    creds = flow.run_local_server(port=0, access_type='offline', prompt='consent')

    token_data = {
        'token':         creds.token,
        'refresh_token': creds.refresh_token,
        'token_uri':     creds.token_uri,
        'client_id':     creds.client_id,
        'client_secret': creds.client_secret,
        'scopes':        list(creds.scopes)
    }

    token_json = json.dumps(token_data)

    print("\n" + "="*60)
    print("SUCCESS! Copy the JSON below and add it as GitHub Secret:")
    print("  Secret name: GMAIL_TOKEN")
    print("="*60)
    print(token_json)
    print("="*60)
    print("\nAlso add your Anthropic API key as:")
    print("  Secret name: ANTHROPIC_API_KEY")
    print("  Value: your key from https://console.anthropic.com")
    print("\nGo to: Your GitHub repo → Settings → Secrets and variables → Actions")

if __name__ == '__main__':
    main()
