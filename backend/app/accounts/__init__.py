"""Users, roles, daily limits, chat history and feedback (doc section 12.10).

The web app signs users in with Google (Auth.js) and hands the API a short
HS256 token; this package verifies it, keeps per-user state in a SQL database
(Postgres on Railway, SQLite locally and in tests) and enforces the budget.
"""
