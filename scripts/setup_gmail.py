#!/usr/bin/env python3
"""
One-time Gmail OAuth2 setup script.
Run this locally ONCE to obtain the credentials needed for GitHub Secrets.

Steps:
  1. Follow the instructions to create a Google Cloud project & credentials
  2. Download credentials.json from Google Cloud Console
  3. Run: python scripts/setup_gmail.py
  4. A browser window will open for Google sign-in
  5. Copy the printed values into your GitHub repository Secrets

Requirements: pip install google-auth-oauthlib
"""

import os
import json

try:
    from google_auth_oauthlib.flow import InstalledAppFlow
except ImportError:
    print("Missing dependency. Run: pip install google-auth-oauthlib")
    raise SystemExit(1)

SCOPES = ["https://www.googleapis.com/auth/gmail.readonly"]

BANNER = "=" * 60


def main():
    print(BANNER)
    print("  Gmail OAuth2 Setup for Sabhya's Task Tracker")
    print(BANNER)
    print()
    print("STEP 1 – Create Google Cloud credentials (if you haven't):")
    print("  1. Go to https://console.cloud.google.com/")
    print("  2. Create / select a project")
    print("  3. Enable the Gmail API:")
    print("     APIs & Services → Library → search 'Gmail API' → Enable")
    print("  4. Create OAuth 2.0 credentials:")
    print("     APIs & Services → Credentials → Create Credentials")
    print("     → OAuth client ID → Desktop app")
    print("  5. Download the JSON file and save it as 'credentials.json'")
    print("     in this project's root directory")
    print()

    creds_path = os.path.join(os.path.dirname(__file__), "..", "credentials.json")
    creds_path = os.path.normpath(creds_path)

    if not os.path.exists(creds_path):
        print(f"ERROR: credentials.json not found at {creds_path}")
        print("Please download it from Google Cloud Console and try again.")
        raise SystemExit(1)

    print("STEP 2 – Authorising with your Google account…")
    print("  A browser window will open. Sign in and grant access.")
    print()

    flow = InstalledAppFlow.from_client_secrets_file(creds_path, SCOPES)
    creds = flow.run_local_server(port=0)

    with open(creds_path) as f:
        client_data = json.load(f)

    installed = client_data.get("installed") or client_data.get("web", {})
    client_id = installed.get("client_id", "")
    client_secret = installed.get("client_secret", "")
    refresh_token = creds.refresh_token

    print()
    print(BANNER)
    print("  SUCCESS! Add these as GitHub Actions Secrets:")
    print("  (Repository → Settings → Secrets and variables → Actions)")
    print(BANNER)
    print()
    print(f"  Secret name:  GMAIL_CLIENT_ID")
    print(f"  Secret value: {client_id}")
    print()
    print(f"  Secret name:  GMAIL_CLIENT_SECRET")
    print(f"  Secret value: {client_secret}")
    print()
    print(f"  Secret name:  GMAIL_REFRESH_TOKEN")
    print(f"  Secret value: {refresh_token}")
    print()
    print("  Also add your Anthropic API key:")
    print("  Secret name:  ANTHROPIC_API_KEY")
    print("  Secret value: <your key from https://console.anthropic.com/>")
    print()
    print(BANNER)
    print()
    print("IMPORTANT: Keep these values private. Do NOT commit credentials.json.")
    print()


if __name__ == "__main__":
    main()
