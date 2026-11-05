# Alap

Alap is a browser-based group video call application. It uses WebRTC for
peer-to-peer audio/video and a Spring Boot WebSocket endpoint for signaling.

## System architecture

<img width="1048" height="827" alt="Untitled Map - WebRTC Architecture" src="https://github.com/user-attachments/assets/e39406e0-189a-4d3a-bd66-895d782640c0" />



### Components

- **Browser client** — `index.html`, `style.css`, and `webrtc.js` request
  camera/microphone access, create `RTCPeerConnection` instances, render remote
  streams, and exchange signaling messages.
- **Signaling server** — `SignalingHandler` maintains room membership and
  forwards messages only to the target WebSocket session in the same room.
- **WebSocket configuration** — `WebSocketConfig` exposes the `/signaling`
  endpoint.
- **Media transport** — audio and video are sent directly between browsers;
  the server does not process or relay media.
- **NAT traversal** — clients use `stun:stun.l.google.com:19302` to discover
  reachable network addresses. No TURN relay is configured.

## Connection flow

1. A user opens the application. If no `room` query parameter exists, the
   client generates one and updates the URL.
2. The browser requests camera and microphone permissions, then connects to
   `/signaling?room=<roomId>`.
3. The server sends an `init` message containing the client's session ID and
   announces new and departed users to the room.
4. When a peer joins, clients create WebRTC offers and answers and exchange ICE
   candidates through the signaling server.
5. Once negotiation completes, media flows directly between each pair of
   participants. The topology is a full mesh, so each client maintains one
   peer connection per remote participant.

## Project structure

```text
src/
├── main/
│   ├── java/com/ricky/Alap/
│   │   ├── AlapApplication.java       # Spring Boot entry point
│   │   ├── config/WebSocketConfig.java
│   │   └── handler/SignalingHandler.java
│   └── resources/
│       ├── application.properties
│       └── static/
│           ├── index.html
│           ├── style.css
│           └── webrtc.js
└── test/
    └── java/com/ricky/Alap/
        └── AlapApplicationTests.java
```

## Requirements

- Java 21
- Maven 3.9+ (or the included Maven Wrapper)
- A browser with WebRTC support

## Run locally

```bash
./mvnw spring-boot:run
```

Open [http://localhost:8081](http://localhost:8081) in a WebRTC-compatible
browser. Share the generated room URL with other participants.

To build and test:

```bash
./mvnw clean test
```

## Run with Docker

```bash
docker build -t alap .
docker run --rm -p 8081:8081 alap
```

Then open [http://localhost:8081](http://localhost:8081).

## Configuration

The server listens on port `8081` by default:

```properties
server.port=8081
```

The signaling endpoint accepts all origins for the current development setup.
For production, restrict allowed origins and serve the application over HTTPS
so browsers can use secure WebSocket connections.

## Current limitations

- Full-mesh WebRTC causes connection and bandwidth usage to grow with the
  number of participants.
- A TURN server is not configured, so some restrictive networks may fail to
  establish peer connections.
- Room state is held in server memory and is lost when the application stops.
- There is no authentication or authorization for room access.
