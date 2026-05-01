"""
Gmail OAuth2 Setup Helper
=========================
Run this ONCE on your local machine to authorise the app and obtain
the refresh token. You will then paste the output into GitHub Secrets.

Usage:
  1. Create a Google Cloud project and enable the Gmail API.
  2. Create OAuth 2.0 credentials (Desktop app type) → download credentials.json.
  3. Place credentials.json in this scripts/ directory (or pass --creds path).
  4. Run:  python scripts/setup_gmail_auth.py
  5. A browser window will open; sign in and grant access.
  6. Copy the two JSON blobs printed to stdout into GitHub Secrets:
       GMAIL_CREDENTIALS  ← content of credentials.json
       GMAIL_TOKEN        ← the token JSON printed by this script
"""

import argparse
import json
import sys
from pathlib import Path

try:
    from google_auth_oauthlib.flow import InstalledAppFlow
    from google.oauth2.credentials import Credentials
except ImportError:
    print("Install dependencies first:  pip install -r scripts/requirements.txt")
    sys.exit(1)

SCOPES = ["https://www.googleapis.com/auth/gmail.readonly"]


def main():
    parser = argparse.ArgumentParser(description="Obtain Gmail OAuth2 refresh token")
    parser.add_argument("--creds", default="scripts/credentials.json",
                        help="Path to credentials.json downloaded from Google Cloud Console")
    args = parser.parse_args()

    creds_path = Path(args.creds)
    if not creds_path.exists():
        print(f"ERROR: {creds_path} not found.")
        print("Download OAuth2 credentials from:")
        print("  https://console.cloud.google.com → APIs & Services → Credentials")
        print("  Create credential → OAuth client ID → Desktop app → Download JSON")
        sys.exit(1)

    creds_json = json.loads(creds_path.read_text())
    print(f"Using credentials from: {creds_path}")

    flow = InstalledAppFlow.from_client_config(creds_json, SCOPES)
    creds: Credentials = flow.run_local_server(port=0, prompt="consent")

    token_data = {
        "token":         creds.token,
        "refresh_token": creds.refresh_token,
        "token_uri":     creds.token_uri,
        "client_id":     creds.client_id,
        "client_secret": creds.client_secret,
        "scopes":        list(creds.scopes),
    }

    print("\n" + "="*60)
    print("SUCCESS! Add these two values to your GitHub repository secrets:")
    print("  Settings → Secrets and variables → Actions → New repository secret")
    print("="*60)

    print("\n--- Secret name: GMAIL_CREDENTIALS ---")
    print(creds_path.read_text())

    print("\n--- Secret name: GMAIL_TOKEN ---")
    print(json.dumps(token_data, indent=2))

    print("\n--- Secret name: ANTHROPIC_API_KEY ---")
    print("(paste your Anthropic API key from https://console.anthropic.com)")

    # Save token locally for reference
    token_out = Path("scripts/gmail_token.json")
    token_out.write_text(json.dumps(token_data, indent=2))
    print(f"\nToken also saved to {token_out} for reference (do NOT commit this file!)")


if __name__ == "__main__":
    main()
