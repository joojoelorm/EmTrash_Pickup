# Deploy Emtrash Pickup for Free

This version can run as a static mobile-first web app on GitHub Pages with Supabase Free as the shared database.

## 1. Create the Supabase backend

1. Go to https://supabase.com and create a free project.
2. Open **SQL Editor**.
3. Copy everything from `supabase-setup.sql`.
4. Run it.
5. Go to **Project Settings > API**.
6. Copy:
   - Project URL
   - anon public key

## 2. Connect the app to Supabase

Open `js/supabase-config.js` and replace:

```js
export const SUPABASE_CONFIG = {
  url: "",
  anonKey: "",
  stateTable: "app_state",
  stateId: "default",
};
```

with:

```js
export const SUPABASE_CONFIG = {
  url: "https://YOUR_PROJECT.supabase.co",
  anonKey: "YOUR_ANON_PUBLIC_KEY",
  stateTable: "app_state",
  stateId: "default",
};
```

Do not use the Supabase `service_role` key in the frontend.

## 3. Push to GitHub

Create a GitHub repository, then from the `binroute` folder:

```bash
git init
git add .
git commit -m "Deploy Emtrash Pickup MVP"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/binroute.git
git push -u origin main
```

## 4. Enable GitHub Pages

1. Open the GitHub repo.
2. Go to **Settings > Pages**.
3. Source: **Deploy from a branch**.
4. Branch: `main`.
5. Folder: `/root`.
6. Save.

Your app will appear at:

```text
https://YOUR_USERNAME.github.io/binroute/
```

## 5. MVP payment setup

For launch, use the manual MoMo flow:

1. Collector sets the price.
2. Resident sends MoMo outside the app.
3. Resident enters transaction reference.
4. Collector confirms received.
5. Admin sees paid jobs and platform fee calculation.

For automatic platform percentage later, integrate Paystack split payments or Hubtel.

## Important MVP security note

This quick free deployment stores all app state in one Supabase JSON row with public read/write policies. That is acceptable only for a demo or very early MVP.

Before real customers:

- Add Supabase Auth.
- Split data into proper tables.
- Add Row Level Security by role.
- Move payment verification to a backend function.
