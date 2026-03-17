# Mafia Party Game (Real-Time Web App)

A real-time multiplayer Mafia-style party game built with modern web technologies. Players can join a room, receive secret roles, and play through night/day cycles with a moderator controlling the flow of the game.

---

## Features

- Room-based multiplayer system
- Unique player join & role assignment
- Roles:
  - Citizen
  - Doctor
  - Angel
  - Moderator
- Night / Day game phases
- Real-time voting system
- Host controls (kick players, return to lobby)
- Live updates using Supabase Realtime
- Fully responsive (mobile-friendly)

---

## Tech Stack

- **Frontend:** Next.js (App Router), React, TypeScript
- **Styling:** Tailwind CSS
- **Backend / DB:** Supabase (PostgreSQL + Realtime)
- **Deployment:** Vercel

---

## Environment Variables

Create a `.env.local` file in the root:

```env
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=your_anon_key
