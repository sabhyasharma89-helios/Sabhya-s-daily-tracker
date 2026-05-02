#!/usr/bin/env python3
"""
Run this script ONCE on your local machine to obtain a Gmail refresh token.
The refresh token never expires (unless revoked) and is what you store in
GitHub Secrets so the automated workflow can read your emails.

Usage:
  1. pip install google-auth-oauthlib
  2. python scripts/get_gmail_token.py
  3. Follow the browser OAuth flow
  4. Copy the printed credentials into GitHub repository Secrets
"""

import json
from google_auth_oauthlib.flow import InstalledAppFlow

SCOPES = ["https://www.googleapis.com/auth/gmail.readonly"]

def main():
    print("=" * 60)
    print("Gmail OAuth Token Generator")
    print("=" * 60)
    print()
    print("Before running this script you need a Google Cloud project")
    print("with the Gmail API enabled and OAuth2 Desktop credentials.")
    print()
    creds_file = input("Path to your client_secret_*.json file: ").strip()

    flow = InstalledAppFlow.from_client_secrets_file(creds_file, SCOPES)
    creds = flow.run_local_server(port=0)

    with open(creds_file) as f:
        client_info = json.load(f)
    client_data = client_info.get("installed") or client_info.get("web", {})

    print()
    print("=" * 60)
    print("SUCCESS! Add these as GitHub Repository Secrets:")
    print("=" * 60)
    print(f"GMAIL_CLIENT_ID     = {client_data.get('client_id', '')}")
    print(f"GMAIL_CLIENT_SECRET = {client_data.get('client_secret', '')}")
    print(f"GMAIL_REFRESH_TOKEN = {creds.refresh_token}")
    print(f"ANTHROPIC_API_KEY   = <your Anthropic API key from console.anthropic.com>")
    print()
    print("Go to: https://github.com/<your-repo>/settings/secrets/actions")
    print("=" * 60)

if __name__ == "__main__":
    main()
