const localVideo = document.getElementById('localVideo');
const remoteVideo = document.getElementById('remoteVideo');
const startButton = document.getElementById('startButton');

let localStream;
let peerConnection;

// Dynamically use wss:// for production (Render) and ws:// for local testing
const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
const wsUrl = `${protocol}//${window.location.host}/signaling`;
const signalingSocket = new WebSocket(wsUrl);

// Google's public STUN server helps bypass basic NAT firewalls
const rtcConfig = {
    iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
};

signalingSocket.onmessage = async (message) => {
    const data = JSON.parse(message.data);

    if (!peerConnection) createPeerConnection();

    if (data.offer) {
        await peerConnection.setRemoteDescription(new RTCSessionDescription(data.offer));
        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);
        signalingSocket.send(JSON.stringify({ answer: peerConnection.localDescription }));
    } else if (data.answer) {
        await peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));
    } else if (data.candidate) {
        await peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
    }
};

async function startMedia() {
    try {
        localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        localVideo.srcObject = localStream;
    } catch (error) {
        console.error('Error accessing media devices.', error);
        alert("Please allow camera and microphone permissions.");
    }
}

function createPeerConnection() {
    peerConnection = new RTCPeerConnection(rtcConfig);

    localStream.getTracks().forEach(track => {
        peerConnection.addTrack(track, localStream);
    });

    peerConnection.ontrack = (event) => {
        remoteVideo.srcObject = event.streams[0];
    };

    peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
            signalingSocket.send(JSON.stringify({ candidate: event.candidate }));
        }
    };
}

startButton.onclick = async () => {
    if (!localStream) return;
    createPeerConnection();
    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    signalingSocket.send(JSON.stringify({ offer: peerConnection.localDescription }));
};

// Request camera automatically on page load
startMedia();