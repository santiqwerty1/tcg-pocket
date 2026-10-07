# Public root CA of the Supabase connection pooler (CN=Supabase Root 2021 CA, valid until 2031-04-26),
# downloaded from https://supabase-downloads.s3-ap-southeast-1.amazonaws.com/prod/ssl/prod-ca-2021.crt
# Node trusts it via NODE_EXTRA_CA_CERTS so `sslmode=verify-full` works (fly.toml [env]).
