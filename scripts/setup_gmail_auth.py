#!/usr/bin/env python3
"""
One-time Gmail OAuth setup.

Run this script ONCE on your local machine to obtain OAuth credentials.
Then add the printed values as GitHub repository secrets.

Prerequisites:
  1. Go to https://console.cloud.google.com/
  2. Create a project (or use an existing one)
  3. Enable the Gmail API
  4. Create OAuth2 credentials → Desktop App
  5. Download the credentials JSON and save it as  credentials.json
     in this scripts/ folder (or anywhere you run this script from)
  6. Run:  python setup_gmail_auth.py

The credentials.json file is NOT committed to git (see .gitignore).
"""

import json
import os
import sys

try:
    from google_auth_oauthlib.flow import InstalledAppFlow
except ImportError:
    print("Install dependencies first:  pip install -r requirements.txt")
    sys.exit(1)

SCOPES = ['https://www.googleapis.com/auth/gmail.readonly']
CRED_FILE = os.path.join(os.path.dirname(__file__), 'credentials.json')


def main():
    if not os.path.exists(CRED_FILE):
        print(f"\n❌  credentials.json not found at: {CRED_FILE}")
        print("\nSteps:")
        print("  1. Go to https://console.cloud.google.com/apis/credentials")
        print("  2. Create OAuth 2.0 Client ID → Desktop App")
        print("  3. Download JSON → rename to credentials.json")
        print(f"  4. Place it at: {CRED_FILE}")
        sys.exit(1)

    print("\n🔐  Starting Gmail OAuth flow…")
    print("    Your browser will open. Sign in and grant access to Gmail (read-only).\n")

    flow  = InstalledAppFlow.from_client_secrets_file(CRED_FILE, SCOPES)
    creds = flow.run_local_server(port=0)

    print("\n" + "=" * 60)
    print("  SUCCESS — Add these as GitHub Repository Secrets")
    print("=" * 60)
    print(f"\nGMAIL_REFRESH_TOKEN:\n  {creds.refresh_token}\n")
    print(f"GMAIL_CLIENT_ID:\n  {creds.client_id}\n")
    print(f"GMAIL_CLIENT_SECRET:\n  {creds.client_secret}\n")
    print("ANTHROPIC_API_KEY:\n  <your key from https://console.anthropic.com/>\n")
    print("=" * 60)
    print("\nHow to add secrets:")
    print("  GitHub repo → Settings → Secrets and variables → Actions → New secret")
    print("\nAfter adding all 4 secrets, go to:")
    print("  Actions → 'Process Emails' → Run workflow → check 'Initial run'")
    print("  (This will read your last 30 days of emails.)")
    print()


if __name__ == '__main__':
    main()
