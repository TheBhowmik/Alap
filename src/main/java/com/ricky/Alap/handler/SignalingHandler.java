package com.ricky.Alap.handler;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
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

    private final Map<String, List<WebSocketSession>> roomSessions = new ConcurrentHashMap<>();
    private final Map<String, String> sessionToRoom = new ConcurrentHashMap<>();
    private final ObjectMapper mapper = new ObjectMapper();

    // Synchronize to prevent TEXT_PARTIAL_WRITING crashes during rapid ICE floods
    private void sendMessageSafely(WebSocketSession session, TextMessage message) throws IOException {
        synchronized (session) {
            if (session.isOpen()) {
                session.sendMessage(message);
            }
        }
    }

    @Override
    public void afterConnectionEstablished(WebSocketSession session) throws Exception {
        String query = session.getUri().getQuery();
        String roomId = (query != null && query.contains("room=")) ? query.split("room=")[1].split("&")[0] : "default";

        sessionToRoom.put(session.getId(), roomId);
        List<WebSocketSession> room = roomSessions.computeIfAbsent(roomId, k -> new CopyOnWriteArrayList<>());

        sendMessageSafely(session, new TextMessage("{\"type\":\"init\", \"id\":\"" + session.getId() + "\"}"));

        TextMessage joinedMessage = new TextMessage("{\"type\":\"user-joined\", \"id\":\"" + session.getId() + "\"}");
        for (WebSocketSession s : room) {
            sendMessageSafely(s, joinedMessage);
        }

        room.add(session);
    }

    @Override
    protected void handleTextMessage(WebSocketSession session, TextMessage message) throws Exception {
        JsonNode json = mapper.readTree(message.getPayload());
        String targetId = json.has("target") ? json.get("target").asText() : null;
        String roomId = sessionToRoom.get(session.getId());

        if (roomId != null && targetId != null) {
            List<WebSocketSession> room = roomSessions.get(roomId);
            for (WebSocketSession s : room) {
                if (s.getId().equals(targetId)) {
                    sendMessageSafely(s, message);
                    break;
                }
            }
        }
    }

    @Override
    public void afterConnectionClosed(WebSocketSession session, CloseStatus status) throws Exception {
        String roomId = sessionToRoom.remove(session.getId());
        if (roomId != null) {
            List<WebSocketSession> room = roomSessions.get(roomId);
            if (room != null) {
                room.remove(session);
                TextMessage leftMessage = new TextMessage("{\"type\":\"user-left\", \"id\":\"" + session.getId() + "\"}");
                for (WebSocketSession s : room) {
                    sendMessageSafely(s, leftMessage);
                }
                if (room.isEmpty()) roomSessions.remove(roomId);
            }
        }
    }
}