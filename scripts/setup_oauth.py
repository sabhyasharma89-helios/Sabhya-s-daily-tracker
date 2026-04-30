#!/usr/bin/env python3
"""
setup_oauth.py
──────────────
One-time helper script to complete the Gmail OAuth2 flow locally
and produce the token JSON you need to store as a GitHub Secret.

Usage:
  1. Download OAuth2 credentials from Google Cloud Console
     (Application type: Desktop App) → save as credentials.json
  2. pip install google-auth-oauthlib
  3. python scripts/setup_oauth.py

The script opens your browser, asks you to sign in and grant access,
then prints the token JSON. Copy it as the GMAIL_TOKEN_JSON secret.
"""

import json
import sys
from pathlib import Path

try:
    from google_auth_oauthlib.flow import InstalledAppFlow
except ImportError:
    print("Install dependencies first:  pip install google-auth-oauthlib")
    sys.exit(1)

SCOPES = ["https://www.googleapis.com/auth/gmail.readonly"]


def main():
    creds_path = Path("credentials.json")
    if not creds_path.exists():
        print(
            "ERROR: credentials.json not found.\n"
            "Download it from Google Cloud Console → APIs & Services → Credentials\n"
            "(OAuth 2.0 Client ID → Desktop App → Download JSON)\n"
            "and place it in the project root."
        )
        sys.exit(1)

    flow = InstalledAppFlow.from_client_secrets_file(str(creds_path), SCOPES)
    creds = flow.run_local_server(port=0)

    token_data = {
        "token":         creds.token,
        "refresh_token": creds.refresh_token,
        "token_uri":     creds.token_uri,
        "client_id":     creds.client_id,
        "client_secret": creds.client_secret,
        "scopes":        list(creds.scopes) if creds.scopes else SCOPES,
    }

    token_json = json.dumps(token_data, indent=2)

    print("\n" + "=" * 60)
    print("SUCCESS! Copy the JSON below as your GMAIL_TOKEN_JSON secret.")
    print("=" * 60)
    print(token_json)
    print("=" * 60)

    # Also write locally for reference
    token_path = Path("token_output.json")
    token_path.write_text(token_json)
    print(f"\nAlso saved to {token_path} (do NOT commit this file).")

    print("\nNext steps:")
    print("  1. In your GitHub repo: Settings → Secrets → Actions")
    print("  2. Add secret  GMAIL_TOKEN_JSON       with the JSON above")
    print("  3. Add secret  GMAIL_CREDENTIALS_JSON with the full contents of credentials.json")
    print("  4. Add secret  ANTHROPIC_API_KEY       with your Claude API key")
    print("  5. Enable GitHub Actions in your repo")
    print("  6. Enable GitHub Pages (Settings → Pages → Deploy from branch: main / root)")


if __name__ == "__main__":
    main()
