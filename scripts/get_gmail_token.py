#!/usr/bin/env python3
"""
One-time helper: obtain a Gmail refresh token.
Run locally: python3 scripts/get_gmail_token.py
"""
import os
from google_auth_oauthlib.flow import InstalledAppFlow

SCOPES = ["https://www.googleapis.com/auth/gmail.readonly"]

CLIENT_ID = input("Enter your Google OAuth Client ID: ").strip()
CLIENT_SECRET = input("Enter your Google OAuth Client Secret: ").strip()

client_config = {
    "installed": {
        "client_id": CLIENT_ID,
        "client_secret": CLIENT_SECRET,
        "redirect_uris": ["urn:ietf:wg:oauth:2.0:oob", "http://localhost"],
        "auth_uri": "https://accounts.google.com/o/oauth2/auth",
        "token_uri": "https://oauth2.googleapis.com/token",
    }
}

flow = InstalledAppFlow.from_client_config(client_config, SCOPES)
creds = flow.run_local_server(port=0)

print("\n✅ Authentication successful!")
print("\nAdd these as GitHub Secrets (Settings → Secrets → Actions):\n")
print(f"GMAIL_CLIENT_ID     = {CLIENT_ID}")
print(f"GMAIL_CLIENT_SECRET = {CLIENT_SECRET}")
print(f"GMAIL_REFRESH_TOKEN = {creds.refresh_token}")
print("\nAlso add:")
print("ANTHROPIC_API_KEY   = sk-ant-...")
