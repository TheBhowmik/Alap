const localVideo = document.getElementById('localVideo');
const videoGrid = document.getElementById('videoGrid');
const roomLink = document.getElementById('roomLink');

let localStream;
let signalingSocket;
let myId;
const peers = {};
const iceCandidatesQueue = {}; // Temp queue for early ICE candidates

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
                document.getElementById('video-' + data.id)?.remove();
            }
        }
        else if (data.target === myId) {
            const peerId = data.sender;

            if (data.type === 'offer') {
                createPeerConnection(peerId);
                await peers[peerId].setRemoteDescription(new RTCSessionDescription(data.offer));
                const answer = await peers[peerId].createAnswer();
                await peers[peerId].setLocalDescription(answer);
                sendSignal('answer', peerId, { answer: peers[peerId].localDescription });
                processIceQueue(peerId); // Drain queue once Remote is set
            }
            else if (data.type === 'answer') {
                await peers[peerId].setRemoteDescription(new RTCSessionDescription(data.answer));
                processIceQueue(peerId); // Drain queue once Remote is set
            }
            else if (data.type === 'candidate') {
                if (!peers[peerId]) createPeerConnection(peerId);

                const candidate = new RTCIceCandidate(data.candidate);

                // Prevent crash: check if the remote description is actually ready
                if (peers[peerId].remoteDescription && peers[peerId].remoteDescription.type) {
                    await peers[peerId].addIceCandidate(candidate).catch(e => console.error(e));
                } else {
                    // Remote description isn't ready yet, queue the candidate safely
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

function sendSignal(type, targetId, payload) {
    if (signalingSocket.readyState === WebSocket.OPEN) {
        signalingSocket.send(JSON.stringify({
            type: type,
            sender: myId,
            target: targetId,
            ...payload
        }));
    } else {
        console.warn("Blocked signal transmission: WebSocket is closed.");
    }
}

function createPeerConnection(peerId) {
    if (peers[peerId]) return;

    const pc = new RTCPeerConnection(rtcConfig);
    peers[peerId] = pc;
    iceCandidatesQueue[peerId] = [];

    localStream.getTracks().forEach(track => pc.addTrack(track, localStream));

    pc.ontrack = (event) => {
        let video = document.getElementById('video-' + peerId);
        if (!video) {
            video = document.createElement('video');
            video.id = 'video-' + peerId;
            video.autoplay = true;
            video.playsInline = true;
            videoGrid.appendChild(video);
        }
        video.srcObject = event.streams[0];
    };

    pc.onicecandidate = (event) => {
        if (event.candidate) {
            sendSignal('candidate', peerId, { candidate: event.candidate });
        }
    };
}

initApp();