import pytest
from channels.exceptions import ChannelFull

from daypage.consumers import PageConsumer

pytestmark = pytest.mark.asyncio


class FullLayer:
    async def send(self, *args, **kwargs):
        raise ChannelFull()

    async def group_send(self, *args, **kwargs):
        raise ChannelFull()


def consumer_with_full_layer() -> PageConsumer:
    c = PageConsumer()
    c.channel_layer = FullLayer()
    c.channel_name = "me"
    c.page_id = 1
    c.presence = {7: (1, {"cursor": {"x": 1, "y": 2}})}
    c.member = type("M", (), {"nickname": "졸린 수달", "color": "#000"})()
    return c


async def test_presence_reply_to_a_full_inbox_is_dropped_not_fatal():
    await consumer_with_full_layer().awareness_query({"reply_to": "someone-else"})


async def test_presence_broadcast_to_full_inboxes_is_dropped_not_fatal():
    from daypage.awareness import encode_message

    await consumer_with_full_layer().receive_awareness(encode_message([(7, 2, {"cursor": {"x": 3, "y": 4}})]))
