# Walking Optimizer

A Next.js web app that lets a user pick two map points, fetch a walking route from GraphHopper, and generate a terrain-aware aerobic pace plan. The app estimates intensity from walking speed plus route grade, then recommends faster/slower pacing to stay in a target cardio zone.

## Features

- Click a start point and destination on the map
- Fetch walking routes with elevation from GraphHopper
- Split the route into segments and calculate grade per segment
- Estimate aerobic intensity using the ACSM walking VO2 formula
- Build a segment-by-segment speed plan based on workout level and target HR zone
- Show live geolocation-based pace guidance and estimated HR/MET stats

## Tech stack

- Next.js 16
- React 19
- TypeScript
- Leaflet / React Leaflet
- GraphHopper Routing API

## Environment variables

Create a `.env.local` file in the project root:

```bash
GRAPHOPPER_KEY=your_graphhopper_api_key
```

You can get an API key from [GraphHopper](https://www.graphhopper.com/).

## Local development

Install dependencies and start the app:

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Build for production

```bash
npm run build
npm run start
```

## Vercel deployment

1. Import the GitHub repo into Vercel.
2. Set the environment variable `GRAPHOPPER_KEY` in the Vercel project settings.
3. Deploy with the default Next.js settings.

No extra server configuration is required because the GraphHopper call is proxied through a Next.js API route.

## Important limitations

- Elevator, staircase, and traffic-light detection are not guaranteed by GraphHopper. This MVP mainly adjusts pace using elevation/grade and route instructions.
- HR and intensity are estimated from route slope and speed. They are not a substitute for wearable HR data or medical advice.
