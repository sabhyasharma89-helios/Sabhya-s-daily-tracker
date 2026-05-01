#!/usr/bin/env python3
"""
Run this script ONCE locally to obtain your Gmail OAuth2 refresh token.
Then add the printed values as GitHub repository secrets.

Prerequisites:
  pip install google-auth-oauthlib

Usage:
  python scripts/get_gmail_token.py
"""

from google_auth_oauthlib.flow import InstalledAppFlow

SCOPES = ['https://www.googleapis.com/auth/gmail.readonly']


def main():
    print("=" * 60)
    print("  Gmail OAuth2 Refresh Token Generator")
    print("=" * 60)
    print()
    print("You'll need OAuth2 credentials from Google Cloud Console:")
    print("  1. Go to https://console.cloud.google.com/")
    print("  2. Create a project → Enable Gmail API")
    print("  3. Create OAuth 2.0 credentials (Desktop app type)")
    print("  4. Copy the Client ID and Client Secret below")
    print()

    client_id = input("Enter your Google OAuth Client ID: ").strip()
    client_secret = input("Enter your Google OAuth Client Secret: ").strip()

    client_config = {
        "installed": {
            "client_id": client_id,
            "client_secret": client_secret,
            "redirect_uris": ["http://localhost"],
            "auth_uri": "https://accounts.google.com/o/oauth2/auth",
            "token_uri": "https://oauth2.googleapis.com/token",
        }
    }

    flow = InstalledAppFlow.from_client_config(client_config, SCOPES)
    creds = flow.run_local_server(port=0)

    print()
    print("=" * 60)
    print("  SUCCESS! Add these secrets to your GitHub repository:")
    print("  (Settings → Secrets and variables → Actions → New secret)")
    print("=" * 60)
    print()
    print(f"GMAIL_CLIENT_ID={client_id}")
    print(f"GMAIL_CLIENT_SECRET={client_secret}")
    print(f"GMAIL_REFRESH_TOKEN={creds.refresh_token}")
    print()
    print("Also add your Anthropic API key:")
    print("ANTHROPIC_API_KEY=sk-ant-...")
    print()


if __name__ == "__main__":
    main()
