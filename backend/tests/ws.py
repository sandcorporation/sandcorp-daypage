"""웹소켓 테스트 도우미: 세션 쿠키로 접속하는 y-websocket 클라이언트 흉내."""

import json

from channels.testing import WebsocketCommunicator
from pycrdt import (
    Doc,
    Map,
    YMessageType,
    YSyncMessageType,
    create_sync_message,
    create_update_message,
    handle_sync_message,
    read_message,
)

from config.asgi import application


class YClient:
    def __init__(self, communicator: WebsocketCommunicator):
        self.ws = communicator
        self.doc = Doc()
        self.texts: list[dict] = []
        # sync 중에 먼저 도착한 awareness 메시지(next_awareness가 먼저 꺼낸다)
        self.awareness: list[bytes] = []

    async def sync(self) -> None:
        """서버 step1에 답하고 내 step1을 보내 서버 문서를 받아온다."""
        await self.ws.send_to(bytes_data=create_sync_message(self.doc))
        got_step2 = False
        while not got_step2:
            msg = await self.ws.receive_output(timeout=3)
            assert msg["type"] == "websocket.send", msg
            got_step2 = await self._handle(msg) == YSyncMessageType.SYNC_STEP2

    async def _handle(self, msg) -> int | None:
        if msg.get("text") is not None:
            self.texts.append(json.loads(msg["text"]))
            return None
        data = msg["bytes"]
        if data[0] == YMessageType.AWARENESS:
            self.awareness.append(data)
            return None
        if data[0] != YMessageType.SYNC:
            return None
        reply = handle_sync_message(data[1:], self.doc)
        if reply is not None:
            await self.ws.send_to(bytes_data=reply)
        return data[1]

    async def drain(self, timeout: float = 0.3) -> None:
        """도착한 메시지를 모두 처리한다."""
        # receive_output은 시간이 다 되면 앱을 취소하므로 먼저 receive_nothing으로 확인한다.
        while not await self.ws.receive_nothing(timeout=timeout):
            msg = await self.ws.receive_output()
            if msg["type"] == "websocket.close":
                self.closed = msg.get("code")
                return
            await self._handle(msg)

    async def add_stroke(self, stroke_id: str, author: str = "a") -> None:
        before = self.doc.get_state()
        strokes = self.doc.get("strokes", type=Map)
        strokes[stroke_id] = Map({"tool": "pen", "author": author, "points": [0.0, 0.0, 0.5]})
        update = self.doc.get_update(before)
        await self.ws.send_to(bytes_data=create_update_message(update))

    def stroke_ids(self) -> set[str]:
        return set(self.doc.get("strokes", type=Map).keys())

    async def close(self) -> None:
        await self.ws.disconnect(timeout=5)


def session_cookie(client) -> bytes:
    return f"sessionid={client.cookies['sessionid'].value}".encode()


async def open_ws(client, note_id: str, date: str, origin: str = "http://localhost") -> WebsocketCommunicator:
    headers = [(b"origin", origin.encode()), (b"host", b"localhost")]
    if client is not None and "sessionid" in client.cookies:
        headers.append((b"cookie", session_cookie(client)))
    communicator = WebsocketCommunicator(application, f"/ws/notes/{note_id}/pages/{date}", headers=headers)
    connected, _ = await communicator.connect(timeout=3)
    assert connected
    return communicator


async def expect_close(communicator: WebsocketCommunicator) -> int:
    while True:
        msg = await communicator.receive_output(timeout=3)
        if msg["type"] == "websocket.close":
            return msg.get("code")


async def join(client, note_id: str, date: str) -> YClient:
    y = YClient(await open_ws(client, note_id, date))
    await y.sync()
    return y


def read_update_message(data: bytes) -> bytes:
    return read_message(data[2:])


def awareness_message(client_id: int, clock: int, state: dict | None) -> bytes:
    from daypage.awareness import encode_message

    return encode_message([(client_id, clock, state)])


async def next_awareness(y: YClient, timeout: float = 3) -> list[tuple[int, int, dict | None]]:
    """다음 awareness 메시지를 기다려 풀어서 돌려준다(그 사이 sync 메시지는 처리)."""
    from daypage.awareness import decode_message

    if y.awareness:
        return decode_message(y.awareness.pop(0))
    while True:
        msg = await y.ws.receive_output(timeout=timeout)
        if msg["type"] == "websocket.close":
            raise AssertionError(f"closed: {msg}")
        data = msg.get("bytes")
        if data and data[0] == YMessageType.AWARENESS:
            return decode_message(data)
        await y._handle(msg)
