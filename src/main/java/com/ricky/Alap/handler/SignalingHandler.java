package com.ricky.Alap.handler;

import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.handler.TextWebSocketHandler;

import java.io.IOException;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CopyOnWriteArrayList;

public class SignalingHandler extends TextWebSocketHandler {

    // Maps a roomId to a list of connected sessions
    private final Map<String, List<WebSocketSession>> roomSessions = new ConcurrentHashMap<>();
    // Maps a sessionId to its roomId for quick lookup
    private final Map<String, String> sessionToRoom = new ConcurrentHashMap<>();

    @Override
    public void afterConnectionEstablished(WebSocketSession session) {
        // Extract room ID from URI: ws://localhost:8080/signaling?room=xyz
        String query = session.getUri().getQuery();
        String roomId = "default";
        if (query != null && query.contains("room=")) {
            roomId = query.split("room=")[1].split("&")[0];
        }

        sessionToRoom.put(session.getId(), roomId);
        roomSessions.computeIfAbsent(roomId, k -> new CopyOnWriteArrayList<>()).add(session);
        System.out.println("Session " + session.getId() + " joined room: " + roomId);
    }

    @Override
    protected void handleTextMessage(WebSocketSession session, TextMessage message) throws IOException {
        String roomId = sessionToRoom.get(session.getId());
        if (roomId == null) return;

        // Broadcast only to sessions in the same room
        List<WebSocketSession> sessions = roomSessions.get(roomId);
        if (sessions != null) {
            for (WebSocketSession webSocketSession : sessions) {
                if (webSocketSession.isOpen() && !session.getId().equals(webSocketSession.getId())) {
                    webSocketSession.sendMessage(message);
                }
            }
        }
    }

    @Override
    public void afterConnectionClosed(WebSocketSession session, CloseStatus status) {
        String roomId = sessionToRoom.remove(session.getId());
        if (roomId != null) {
            List<WebSocketSession> sessions = roomSessions.get(roomId);
            if (sessions != null) {
                sessions.remove(session);
                // Memory management: clean up empty rooms
                if (sessions.isEmpty()) {
                    roomSessions.remove(roomId);
                }
            }
        }
    }
}