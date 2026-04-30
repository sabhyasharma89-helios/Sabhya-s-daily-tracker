#!/usr/bin/env python3
"""
Run this script ONCE on your local machine to generate Gmail OAuth tokens.
It opens a browser window for you to authorise access, then prints the
values you need to add as GitHub repository secrets.

Usage:
  1. Download OAuth credentials from Google Cloud Console (Desktop app type)
     and save as credentials.json in this directory.
  2. pip install google-auth-oauthlib google-auth google-api-python-client
  3. python setup_gmail_auth.py
  4. Copy the printed secret values into your GitHub repo secrets.
"""

import json
import os
import sys

try:
    from google_auth_oauthlib.flow import InstalledAppFlow
    from google.auth.transport.requests import Request
    from google.oauth2.credentials import Credentials
except ImportError:
    print('Install dependencies first: pip install google-auth-oauthlib google-auth google-api-python-client')
    sys.exit(1)

SCOPES = ['https://www.googleapis.com/auth/gmail.readonly']
CREDS_FILE = os.path.join(os.path.dirname(__file__), 'credentials.json')
TOKEN_FILE  = os.path.join(os.path.dirname(__file__), 'token.json')


def main():
    if not os.path.exists(CREDS_FILE):
        print(f'ERROR: {CREDS_FILE} not found.')
        print()
        print('Steps to create it:')
        print('  1. Go to https://console.cloud.google.com/')
        print('  2. Create (or select) a project')
        print('  3. Enable the Gmail API')
        print('  4. Go to APIs & Services → Credentials')
        print('  5. Create credentials → OAuth client ID → Desktop application')
        print('  6. Download the JSON and save it as scripts/credentials.json')
        sys.exit(1)

    creds = None
    if os.path.exists(TOKEN_FILE):
        creds = Credentials.from_authorized_user_file(TOKEN_FILE, SCOPES)

    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            creds.refresh(Request())
        else:
            flow = InstalledAppFlow.from_client_secrets_file(CREDS_FILE, SCOPES)
            creds = flow.run_local_server(port=0)
        with open(TOKEN_FILE, 'w') as f:
            f.write(creds.to_json())
        print(f'Token saved to {TOKEN_FILE}')

    with open(CREDS_FILE) as f:
        creds_content = f.read()
    with open(TOKEN_FILE) as f:
        token_content = f.read()

    sep = '=' * 62
    print()
    print(sep)
    print('SUCCESS! Add these as GitHub Repository Secrets:')
    print('  Go to: Settings → Secrets and variables → Actions → New secret')
    print(sep)
    print()
    print('Secret name : GMAIL_CREDENTIALS_JSON')
    print('Secret value:')
    print(creds_content)
    print()
    print('Secret name : GMAIL_TOKEN_JSON')
    print('Secret value:')
    print(token_content)
    print()
    print('Secret name : ANTHROPIC_API_KEY')
    print('Secret value: <your Anthropic API key from https://console.anthropic.com/>')
    print()
    print(sep)
    print('NOTE: credentials.json and token.json contain secrets.')
    print('Do NOT commit them to git. They are in .gitignore.')
    print(sep)


if __name__ == '__main__':
    main()
