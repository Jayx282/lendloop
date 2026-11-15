// Prints the n8n credentials LendLoop needs as JSON for `n8n import:credentials`.
// Secrets come from environment variables (.env.automation via docker compose);
// n8n encrypts them with its instance key on import. Never commit the output.
//
// The IDs are fixed because the exported workflows reference credentials by ID.

const secret = (name) => {
  const value = process.env[name];
  if (!value || value.length < 32) throw new Error(`${name} must be at least 32 characters`);
  return value;
};

const credentials = [
  {
    id: "LLjwtConvexToN8n",
    name: "LendLoop: Convex -> n8n signing key",
    type: "jwtAuth",
    data: { keyType: "passphrase", secret: secret("CONVEX_TO_N8N_SIGNING_SECRET"), algorithm: "HS256" },
  },
  {
    id: "LLjwtN8nToConvex",
    name: "LendLoop: n8n -> Convex signing key",
    type: "jwtAuth",
    data: { keyType: "passphrase", secret: secret("N8N_TO_CONVEX_SIGNING_SECRET"), algorithm: "HS256" },
  },
  {
    // Local Mailpit inbox; swap host/port/user/password for a real SMTP provider in production.
    id: "LLsmtpMailpit001",
    name: "LendLoop: SMTP (Mailpit)",
    type: "smtp",
    data: { host: "mailpit", port: 1025, secure: false, disableStartTls: true, user: "", password: "" },
  },
];

process.stdout.write(JSON.stringify(credentials));
