#!/usr/bin/env python3
"""
One-time Gmail OAuth Setup
Run this LOCALLY (not in CI) to obtain a refresh token for GitHub Actions.

Usage:
  1. Complete the Google Cloud Console setup (see README.md)
  2. Place your downloaded credentials.json in this directory
  3. Run:  python setup_gmail_auth.py
  4. A browser tab will open — sign in and grant Gmail read access
  5. The script will print the values you need to add as GitHub Secrets
"""

import json
from pathlib import Path

try:
    from google_auth_oauthlib.flow import InstalledAppFlow
except ImportError:
    print("Please install: pip install google-auth-oauthlib")
    raise

SCOPES = ['https://www.googleapis.com/auth/gmail.readonly']
CREDS_FILE = Path(__file__).parent / 'credentials.json'

def main():
    if not CREDS_FILE.exists():
        print(f"\n❌  {CREDS_FILE} not found.")
        print("Download it from Google Cloud Console → APIs & Services → Credentials")
        print("(OAuth 2.0 Client IDs → Download JSON → save as credentials.json here)\n")
        return

    flow = InstalledAppFlow.from_client_secrets_file(str(CREDS_FILE), SCOPES)
    creds = flow.run_local_server(port=0)

    with open(CREDS_FILE) as f:
        raw = json.load(f)
    client_section = raw.get('installed') or raw.get('web', {})

    print("\n" + "═"*60)
    print("✅  OAuth successful! Add these as GitHub Repository Secrets:")
    print("═"*60)
    print(f"GMAIL_CLIENT_ID      = {client_section.get('client_id', '')}")
    print(f"GMAIL_CLIENT_SECRET  = {client_section.get('client_secret', '')}")
    print(f"GMAIL_REFRESH_TOKEN  = {creds.refresh_token}")
    print("═"*60)
    print("\nGo to: GitHub repo → Settings → Secrets and variables → Actions → New repository secret")
    print("Add each of the above, plus ANTHROPIC_API_KEY (your Claude API key).\n")

if __name__ == '__main__':
    main()
