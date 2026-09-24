import os

# Tests must not write traces into the real Langfuse project. load_dotenv()
# never overrides variables that are already set, so empty keys win over
# backend/.env and app.observability turns tracing off.
os.environ["LANGFUSE_PUBLIC_KEY"] = ""
os.environ["LANGFUSE_SECRET_KEY"] = ""
