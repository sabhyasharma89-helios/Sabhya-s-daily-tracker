#!/usr/bin/env python3
"""
Run this script locally ONCE to generate Gmail OAuth token.
It will open a browser for authentication, then save token.json.
Upload the contents of token.json as GitHub Secret GMAIL_TOKEN.
Upload the contents of credentials.json as GitHub Secret GMAIL_CREDENTIALS.
"""

import json
import os
from google_auth_oauthlib.flow import InstalledAppFlow
from google.oauth2.credentials import Credentials

SCOPES = ['https://www.googleapis.com/auth/gmail.readonly']


def setup():
    creds_file = input("Path to your credentials.json from Google Cloud Console: ").strip()
    if not os.path.exists(creds_file):
        print(f"File not found: {creds_file}")
        return

    flow = InstalledAppFlow.from_client_secrets_file(creds_file, SCOPES)
    creds = flow.run_local_server(port=0)

    token_data = {
        "token": creds.token,
        "refresh_token": creds.refresh_token,
        "token_uri": creds.token_uri,
        "client_id": creds.client_id,
        "client_secret": creds.client_secret,
        "scopes": list(creds.scopes)
    }

    token_file = "token.json"
    with open(token_file, "w") as f:
        json.dump(token_data, f, indent=2)

    print(f"\n✅ Token saved to {token_file}")
    print("\nNext steps:")
    print(f"1. Go to your GitHub repo → Settings → Secrets → Actions")
    print(f"2. Add secret GMAIL_TOKEN = contents of {token_file}")
    print(f"3. Add secret GMAIL_CREDENTIALS = contents of {creds_file}")
    print(f"4. Add secret ANTHROPIC_API_KEY = your Anthropic API key")
    print(f"5. Enable GitHub Pages in repo Settings → Pages (source: main branch, root /)")
    print(f"6. Manually trigger the workflow once with 'initial_run: true' for the first 30 days of data")


if __name__ == "__main__":
    setup()
