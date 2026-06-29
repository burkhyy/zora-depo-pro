# Zoom Depo Pro - Railway Deployment

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
   - `PREPARATION_LOCK_MINUTES=120`
   - `CLOUDINARY_CLOUD_NAME`
   - `CLOUDINARY_API_KEY`
   - `CLOUDINARY_API_SECRET`
4. Generate a Railway domain for the service.
5. Open the HTTPS address and install Zoom Depo from the browser menu.

Railway supplies `PORT` automatically. Do not add API secrets to GitHub.
Cloudinary variables are required only for package-photo uploads. The API secret
is used by the backend and is never sent to the browser.

## Updates

Push changes to the `main` branch. Railway builds the Docker image and deploys
the new version automatically. The volume mounted at `/app/data` keeps
`locations.db` across deployments.

## Backup

Back up `/app/data/locations.db` regularly. It contains raf assignments and
shipment status records.
