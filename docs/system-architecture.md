# System Architecture

Alap is a single Spring Boot application serving a static browser client and a
WebSocket signaling endpoint. Meeting media is deliberately kept out of the
server path: browsers negotiate direct WebRTC connections with one another.

## Logical view

```mermaid
flowchart TB
    subgraph Client["Browser client"]
        UI["index.html + style.css"]
        App["webrtc.js"]
        Media["Camera and microphone"]
        Peer["RTCPeerConnection mesh"]
        Data["WebRTC data channels"]
        UI --> App
        App --> Media
        App --> Peer
        App --> Data
    end

    subgraph Server["Spring Boot application"]
        Static["Static resource handler"]
        Config["WebSocketConfig"]
        Handler["SignalingHandler"]
        Rooms[("In-memory room/session maps")]
        Config --> Handler
        Handler --> Rooms
    end

    Browser["Other participant browsers"]
    STUN["stun:stun.l.google.com:19302"]

    App -->|"HTTP GET"| Static
    App <-->|"WebSocket signaling"| Handler
    Peer <-->|"WebRTC audio/video"| Browser
    Data <-->|"Chat/file data"| Browser
    Peer -.->|"ICE server lookup"| STUN
```

## Component responsibilities

| Component | Responsibility |
| --- | --- |
| `index.html` | Defines the meeting UI, controls, video grid, chat panel, and file input. |
| `style.css` | Provides the meeting layout and interaction styling. |
| `webrtc.js` | Owns room discovery, media permissions, peer connections, screen sharing, chat, file transfer, and participant cleanup. |
| `WebSocketConfig` | Registers the `/signaling` WebSocket endpoint. |
| `SignalingHandler` | Tracks sessions by room, sends lifecycle events, and forwards targeted signaling messages. |
| STUN server | Helps clients discover public network candidates during ICE negotiation. |

## Runtime sequence

```mermaid
sequenceDiagram
    participant U1 as Browser A
    participant S as SignalingHandler
    participant U2 as Browser B

    U1->>S: Connect /signaling?room=id
    S-->>U1: init(sessionId)
    U2->>S: Connect /signaling?room=id
    S-->>U1: user-joined(U2)
    S-->>U2: init(sessionId)
    U1->>S: offer + ICE candidates
    S->>U2: Forward targeted messages
    U2->>S: answer + ICE candidates
    S->>U1: Forward targeted messages
    U1->>U2: Direct WebRTC media/data
    U2->>U1: Direct WebRTC media/data
    U2-->>S: Disconnect
    S-->>U1: user-left(U2)
```

## Data paths

- **Audio/video:** Captured with `getUserMedia`, added to each peer
  connection, and sent directly between browsers.
- **Screen sharing:** `getDisplayMedia` obtains a screen track; each peer
  connection replaces its video sender track until sharing stops.
- **Chat:** A chat message is sent as a targeted JSON message over the
  signaling WebSocket to each connected peer.
- **Files:** The sender creates a `fileTransfer` data channel, sends metadata,
  then sends 16 KB binary chunks. The client limits files to 15 MB.
- **Signaling:** SDP offers, answers, and ICE candidates are routed by session
  ID and are accepted only for sessions in the sender's room.

## Deployment boundaries

The Docker image builds the application with Maven and runs the packaged JAR on
port `8081`. The same process serves the static client and handles WebSocket
signaling. For production, terminate TLS in front of the application, use
`wss://`, restrict WebSocket origins, configure a TURN service, and provide
shared room state if multiple application instances are deployed.

## Scaling and security considerations

The full-mesh topology requires each browser to maintain `N - 1` connections,
so connection count and upload bandwidth increase quickly as rooms grow. A
selective forwarding unit (SFU) would be the next architectural step for
larger rooms.

Room IDs currently act as the only room address, and the server has no
authentication or authorization layer. Room access controls, input validation,
origin restrictions, HTTPS, and TURN credentials should be added before
production use.
