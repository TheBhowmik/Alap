const localVideo = document.getElementById('localVideo');
const videoGrid = document.getElementById('videoGrid');
const roomLink = document.getElementById('roomLink');
const localNameDisplay = document.getElementById('localName');

const nameModal = document.getElementById('nameModal');
const joinBtn = document.getElementById('joinBtn');
const userNameInput = document.getElementById('userNameInput');

let localStream;
let signalingSocket;
let myId;
let myName = "Guest";
const peers = {};
const iceCandidatesQueue = {};

const rtcConfig = {
    iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
};

const urlParams = new URLSearchParams(window.location.search);
let roomId = urlParams.get('room');
if (!roomId) {
    roomId = Math.random().toString(36).substring(2, 10);
    window.history.pushState({}, '', `?room=${roomId}`);
}
roomLink.href = window.location.href;
roomLink.innerText = window.location.href;

// 1. Wait for User Name Before Starting
joinBtn.addEventListener('click', () => {
    const val = userNameInput.value.trim();
    if (val) {
        myName = val;
        localNameDisplay.innerText = myName + " (You)";
        nameModal.style.display = 'none';
        initApp(); // Start camera and WebSocket
    }
});

// Allow hitting "Enter" to join
userNameInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') joinBtn.click();
});

async function initApp() {
    try {
        localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        localVideo.srcObject = localStream;
        connectWebSocket();
    } catch (error) {
        console.error('Error accessing media.', error);
        alert("Camera/Mic permissions required for group call.");
    }
}

function connectWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    signalingSocket = new WebSocket(`${protocol}//${window.location.host}/signaling?room=${roomId}`);

    signalingSocket.onmessage = async (message) => {
        const data = JSON.parse(message.data);

        if (data.type === 'init') {
            myId = data.id;
        }
        else if (data.type === 'user-joined') {
            const peerId = data.id;
            // Existing user sees someone join, preps a container with a placeholder name
            createPeerConnection(peerId, "Connecting...");
            const offer = await peers[peerId].createOffer();
            await peers[peerId].setLocalDescription(offer);
            sendSignal('offer', peerId, { offer: peers[peerId].localDescription });
        }
        else if (data.type === 'user-left') {
            if (peers[data.id]) {
                peers[data.id].close();
                delete peers[data.id];
                delete iceCandidatesQueue[data.id];
                // Remove the wrapper div, not just the video
                document.getElementById('wrapper-' + data.id)?.remove();
            }
        }
        else if (data.target === myId) {
            const peerId = data.sender;
            const peerName = data.senderName || "Guest"; // Read incoming name

            if (data.type === 'offer') {
                createPeerConnection(peerId, peerName);
                await peers[peerId].setRemoteDescription(new RTCSessionDescription(data.offer));
                const answer = await peers[peerId].createAnswer();
                await peers[peerId].setLocalDescription(answer);
                sendSignal('answer', peerId, { answer: peers[peerId].localDescription });
                processIceQueue(peerId);
            }
            else if (data.type === 'answer') {
                setPeerName(peerId, peerName); // Update placeholder to actual name
                await peers[peerId].setRemoteDescription(new RTCSessionDescription(data.answer));
                processIceQueue(peerId);
            }
            else if (data.type === 'candidate') {
                if (!peers[peerId]) createPeerConnection(peerId, peerName);

                const candidate = new RTCIceCandidate(data.candidate);
                if (peers[peerId].remoteDescription && peers[peerId].remoteDescription.type) {
                    await peers[peerId].addIceCandidate(candidate).catch(e => console.error(e));
                } else {
                    if (!iceCandidatesQueue[peerId]) iceCandidatesQueue[peerId] = [];
                    iceCandidatesQueue[peerId].push(candidate);
                }
            }
        }
    };
}

function processIceQueue(peerId) {
    if (iceCandidatesQueue[peerId]) {
        iceCandidatesQueue[peerId].forEach(candidate => {
            peers[peerId].addIceCandidate(candidate).catch(e => console.error("Error adding queued ICE", e));
        });
        iceCandidatesQueue[peerId] = [];
    }
}

// 2. Inject `senderName` into every payload
function sendSignal(type, targetId, payload) {
    if (signalingSocket && signalingSocket.readyState === WebSocket.OPEN) {
        signalingSocket.send(JSON.stringify({
            type: type,
            sender: myId,
            senderName: myName,
            target: targetId,
            ...payload
        }));
    }
}

// 3. Construct HTML Wrappers for Remote Feeds
function createPeerConnection(peerId, peerName) {
    if (peers[peerId]) return;

    const pc = new RTCPeerConnection(rtcConfig);
    peers[peerId] = pc;
    iceCandidatesQueue[peerId] = [];

    localStream.getTracks().forEach(track => pc.addTrack(track, localStream));

    pc.ontrack = (event) => {
        let wrapper = document.getElementById('wrapper-' + peerId);
        if (!wrapper) {
            wrapper = document.createElement('div');
            wrapper.id = 'wrapper-' + peerId;
            wrapper.className = 'video-wrapper';

            const video = document.createElement('video');
            video.id = 'video-' + peerId;
            video.autoplay = true;
            video.playsInline = true;

            const nameTag = document.createElement('div');
            nameTag.id = 'name-' + peerId;
            nameTag.className = 'name-tag';
            nameTag.innerText = peerName;

            wrapper.appendChild(video);
            wrapper.appendChild(nameTag);
            videoGrid.appendChild(wrapper);
        }
        document.getElementById('video-' + peerId).srcObject = event.streams[0];
    };

    pc.onicecandidate = (event) => {
        if (event.candidate) {
            sendSignal('candidate', peerId, { candidate: event.candidate });
        }
    };
}

function setPeerName(peerId, name) {
    const nameTag = document.getElementById('name-' + peerId);
    if (nameTag && name) {
        nameTag.innerText = name;
    }
}