const localVideo = document.getElementById('localVideo');
const videoGrid = document.getElementById('videoGrid');
const roomLink = document.getElementById('roomLink');
const localNameDisplay = document.getElementById('localName');

const nameModal = document.getElementById('nameModal');
const joinBtn = document.getElementById('joinBtn');
const userNameInput = document.getElementById('userNameInput');
const shareScreenBtn = document.getElementById('shareScreenBtn');

let localStream;
let signalingSocket;
let myId;
let myName = "Guest";
const peers = {};
const peerNames = {}; // Dictionary to safely store real names
const iceCandidatesQueue = {};

let screenStream = null;
let isSharingScreen = false;

const rtcConfig = {
    iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
};

// 1. URL Setup & Room Generation
const urlParams = new URLSearchParams(window.location.search);
let roomId = urlParams.get('room');
if (!roomId) {
    roomId = Math.random().toString(36).substring(2, 10);
    window.history.pushState({}, '', `?room=${roomId}`);
}
roomLink.href = window.location.href;
roomLink.innerText = window.location.href;

// 2. Name Entry Modal Logic
joinBtn.addEventListener('click', () => {
    const val = userNameInput.value.trim();
    if (val) {
        myName = val;
        localNameDisplay.innerText = myName + " (You)";
        nameModal.style.display = 'none';
        initApp(); // Start camera and WebSocket only after name is entered
    }
});

// Allow hitting "Enter" to join
userNameInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') joinBtn.click();
});

// 3. Initialize Media and Application
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

// 4. WebSocket & Signaling Logic
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
            createPeerConnection(peerId);
            const offer = await peers[peerId].createOffer();
            await peers[peerId].setLocalDescription(offer);
            sendSignal('offer', peerId, { offer: peers[peerId].localDescription });
        }
        else if (data.type === 'user-left') {
            if (peers[data.id]) {
                peers[data.id].close();
                delete peers[data.id];
                delete iceCandidatesQueue[data.id];
                delete peerNames[data.id];
                document.getElementById('wrapper-' + data.id)?.remove();
            }
        }
        else if (data.target === myId) {
            const peerId = data.sender;

            // Always store the freshest name we receive from this peer
            if (data.senderName) {
                peerNames[peerId] = data.senderName;
                setPeerName(peerId, data.senderName); // Update UI if it exists already
            }

            if (data.type === 'offer') {
                createPeerConnection(peerId);
                await peers[peerId].setRemoteDescription(new RTCSessionDescription(data.offer));
                const answer = await peers[peerId].createAnswer();
                await peers[peerId].setLocalDescription(answer);
                sendSignal('answer', peerId, { answer: peers[peerId].localDescription });
                processIceQueue(peerId);
            }
            else if (data.type === 'answer') {
                await peers[peerId].setRemoteDescription(new RTCSessionDescription(data.answer));
                processIceQueue(peerId);
            }
            else if (data.type === 'candidate') {
                if (!peers[peerId]) createPeerConnection(peerId);

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

// 5. Helper Functions
function processIceQueue(peerId) {
    if (iceCandidatesQueue[peerId]) {
        iceCandidatesQueue[peerId].forEach(candidate => {
            peers[peerId].addIceCandidate(candidate).catch(e => console.error("Error adding queued ICE", e));
        });
        iceCandidatesQueue[peerId] = [];
    }
}

function sendSignal(type, targetId, payload) {
    if (signalingSocket && signalingSocket.readyState === WebSocket.OPEN) {
        signalingSocket.send(JSON.stringify({
            type: type,
            sender: myId,
            senderName: myName,
            target: targetId,
            ...payload
        }));
    } else {
        console.warn("Blocked signal transmission: WebSocket is closed.");
    }
}

function setPeerName(peerId, name) {
    const nameTag = document.getElementById('name-' + peerId);
    if (nameTag && name) {
        nameTag.innerText = name;
    }
}

// 6. WebRTC Peer Connection Setup
function createPeerConnection(peerId) {
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

            // Pull the latest name from the dictionary, fallback to Connecting...
            nameTag.innerText = peerNames[peerId] || "Connecting...";

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

// 7. Screen Sharing Logic
if (shareScreenBtn) {
    shareScreenBtn.addEventListener('click', async () => {
        if (!isSharingScreen) {
            try {
                // Ask the user for screen permissions
                screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
                const screenTrack = screenStream.getVideoTracks()[0];

                // Swap the webcam track with the screen track for ALL connected peers
                for (let peerId in peers) {
                    const sender = peers[peerId].getSenders().find(s => s.track.kind === 'video');
                    if (sender) {
                        sender.replaceTrack(screenTrack);
                    }
                }

                // Update our local video element to show the screen
                localVideo.srcObject = screenStream;

                // Update UI
                isSharingScreen = true;
                shareScreenBtn.innerText = "Stop Sharing";
                shareScreenBtn.classList.add("sharing-active");

                // Listen for the native browser "Stop sharing" popup button
                screenTrack.onended = () => {
                    stopScreenShare();
                };

            } catch (error) {
                console.error("Error sharing screen or user canceled:", error);
            }
        } else {
            // User clicked our custom button to stop sharing
            stopScreenShare();
        }
    });
}

function stopScreenShare() {
    if (!isSharingScreen) return;

    // Grab the original webcam video track
    const webcamTrack = localStream.getVideoTracks()[0];

    // Swap the screen track back to the webcam track for ALL peers
    for (let peerId in peers) {
        const sender = peers[peerId].getSenders().find(s => s.track.kind === 'video');
        if (sender) {
            sender.replaceTrack(webcamTrack);
        }
    }

    // Revert our local video element
    localVideo.srcObject = localStream;

    // Turn off the screen sharing stream to save memory
    if (screenStream) {
        screenStream.getTracks().forEach(track => track.stop());
        screenStream = null;
    }

    // Revert UI
    isSharingScreen = false;
    if (shareScreenBtn) {
        shareScreenBtn.innerText = "Share Screen";
        shareScreenBtn.classList.remove("sharing-active");
    }
}