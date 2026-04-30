#!/usr/bin/env python3
"""
One-time Gmail OAuth2 setup script.
Run this locally to generate a refresh token, then store it in GitHub Secrets.

Usage:
  pip install google-auth-oauthlib
  python scripts/setup_oauth.py
"""

import json
import os
from google_auth_oauthlib.flow import InstalledAppFlow

SCOPES = ['https://www.googleapis.com/auth/gmail.readonly']


def main():
    print("=== Gmail OAuth2 Setup ===\n")
    print("Steps:")
    print("1. Go to https://console.cloud.google.com/")
    print("2. Create a project → Enable Gmail API")
    print("3. Create OAuth 2.0 credentials (Desktop App type)")
    print("4. Download the credentials JSON file\n")

    creds_path = input("Path to your downloaded credentials JSON file: ").strip()
    if not os.path.exists(creds_path):
        print(f"File not found: {creds_path}")
        return

    flow = InstalledAppFlow.from_client_secrets_file(creds_path, SCOPES)
    creds = flow.run_local_server(port=0)

    print("\n=== SUCCESS ===")
    print("Add the following secrets to your GitHub repository")
    print("(Settings → Secrets → Actions → New repository secret):\n")
    print(f"GMAIL_CLIENT_ID     = {creds.client_id}")
    print(f"GMAIL_CLIENT_SECRET = {creds.client_secret}")
    print(f"GMAIL_REFRESH_TOKEN = {creds.refresh_token}")
    print("\nAlso add:")
    print("ANTHROPIC_API_KEY   = your-anthropic-api-key")
    print("\nDone! Your tracker will process emails automatically.")


if __name__ == '__main__':
    main()
