const localVideo = document.getElementById('localVideo');
const remoteVideo = document.getElementById('remoteVideo');
const startButton = document.getElementById('startButton');
const roomLink = document.getElementById('roomLink');

let localStream;
let peerConnection;

// 1. Room ID Generation and URL handling
const urlParams = new URLSearchParams(window.location.search);
let roomId = urlParams.get('room');

if (!roomId) {
    // Generate an 8-character random room string
    roomId = Math.random().toString(36).substring(2, 10);
    // Update the browser URL without reloading the page
    window.history.pushState({}, '', `?room=${roomId}`);
}

// Update UI banner
roomLink.href = window.location.href;
roomLink.innerText = window.location.href;

// 2. Connect to WebSocket passing the Room ID
const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
const wsUrl = `${protocol}//${window.location.host}/signaling?room=${roomId}`;
const signalingSocket = new WebSocket(wsUrl);

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

startMedia();