# Zora Depo Pro - Railway Deployment

## Railway setup

1. Create a Railway project from the GitHub repository.
2. Add a volume to the service and mount it at `/app/data`.
3. Add these service variables:
   - `API_URL`
   - `API_KEY`
   - `API_SECRET`
   - `APP_USERNAME`
   - `APP_PASSWORD`
   - `DATA_DIR=/app/data`
4. Generate a Railway domain for the service.
5. Open the HTTPS address and install Zora Depo from the browser menu.

Railway supplies `PORT` automatically. Do not add API secrets to GitHub.

## Updates

Push changes to the `main` branch. Railway builds the Docker image and deploys
the new version automatically. The volume mounted at `/app/data` keeps
`locations.db` across deployments.

## Backup

Back up `/app/data/locations.db` regularly. It contains raf assignments and
shipment status records.
