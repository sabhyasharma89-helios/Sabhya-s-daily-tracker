#!/usr/bin/env python3
"""
setup_auth.py
─────────────
Run this ONCE on your local machine to obtain a Gmail OAuth refresh token.
Copy the printed JSON into the GitHub Secret  GMAIL_TOKEN_JSON.

Usage:
  1.  pip install google-auth-oauthlib
  2.  Download OAuth 2.0 Desktop credentials from Google Cloud Console
      (APIs & Services → Credentials → Create → Desktop app)
      and save as  credentials.json  in this directory.
  3.  python scripts/setup_auth.py
  4.  A browser window opens — sign in and grant Gmail read access.
  5.  Copy the printed JSON blob into GitHub Secret  GMAIL_TOKEN_JSON.
"""

import json, os, sys
from pathlib import Path

try:
    from google_auth_oauthlib.flow import InstalledAppFlow
    from google.auth.transport.requests import Request
    from google.oauth2.credentials import Credentials
except ImportError:
    sys.exit('Run:  pip install google-auth-oauthlib')

SCOPES      = ['https://www.googleapis.com/auth/gmail.readonly']
CREDS_FILE  = Path('credentials.json')
TOKEN_FILE  = Path('token.json')


def main():
    if not CREDS_FILE.exists():
        sys.exit(
            f'credentials.json not found.\n'
            f'Download it from Google Cloud Console:\n'
            f'  APIs & Services → Credentials → Create OAuth client → Desktop app\n'
            f'  then save as  {CREDS_FILE.resolve()}'
        )

    flow = InstalledAppFlow.from_client_secrets_file(str(CREDS_FILE), SCOPES)
    creds = flow.run_local_server(port=0)

    token_dict = {
        'token':         creds.token,
        'refresh_token': creds.refresh_token,
        'token_uri':     creds.token_uri,
        'client_id':     creds.client_id,
        'client_secret': creds.client_secret,
        'scopes':        list(creds.scopes),
    }

    TOKEN_FILE.write_text(json.dumps(token_dict, indent=2))
    print('\n✅  Token saved to token.json')
    print('\n─── Copy the text below into GitHub Secret  GMAIL_TOKEN_JSON  ───\n')
    print(json.dumps(token_dict))
    print('\n──────────────────────────────────────────────────────────────────\n')
    print('⚠️   Delete credentials.json and token.json after you are done.')


if __name__ == '__main__':
    main()
