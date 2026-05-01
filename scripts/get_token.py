#!/usr/bin/env python3
"""One-time script to get Gmail OAuth refresh token.
Run this locally, follow the browser prompt, and copy the refresh_token to GitHub Secrets."""

import os
from google_auth_oauthlib.flow import InstalledAppFlow
import json

SCOPES = ['https://www.googleapis.com/auth/gmail.readonly']

# Paste your client_secret JSON content here or set the path below
CLIENT_SECRETS_FILE = 'client_secret.json'  # Download from Google Cloud Console

def main():
    flow = InstalledAppFlow.from_client_secrets_file(CLIENT_SECRETS_FILE, SCOPES)
    creds = flow.run_local_server(port=0)
    print('\n=== Copy these values to GitHub Secrets ===')
    print(f'GMAIL_REFRESH_TOKEN: {creds.refresh_token}')
    print(f'GMAIL_CLIENT_ID:     {creds.client_id}')
    print(f'GMAIL_CLIENT_SECRET: {creds.client_secret}')

if __name__ == '__main__':
    main()
