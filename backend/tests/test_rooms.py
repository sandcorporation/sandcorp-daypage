from daypage.rooms import Conn, admitted


def conn(user_id: int, joined: float, channel: str = "c") -> Conn:
    return Conn("2026-10-15", f"{channel}{user_id}{joined}", user_id, joined)


def test_first_people_by_join_time_are_admitted():
    conns = [conn(1, 1.0), conn(2, 2.0), conn(3, 3.0)]
    assert admitted(conns, 2, limit=2) is True
    assert admitted(conns, 3, limit=2) is False


def test_simultaneous_newcomers_agree_on_who_gets_in():
    # 19명이 있고 셋이 동시에 등록했다. 모두 같은 목록을 보고 같은 결론을 내야 한다.
    conns = [conn(i, float(i)) for i in range(1, 20)] + [conn(20, 100.0), conn(21, 100.1), conn(22, 100.2)]
    results = {u: admitted(conns, u, limit=20) for u in (20, 21, 22)}
    assert results == {20: True, 21: False, 22: False}


def test_extra_tabs_of_an_admitted_person_are_fine():
    conns = [conn(1, 1.0), conn(2, 2.0), conn(1, 5.0, "tab2")]
    assert admitted(conns, 1, limit=2) is True


def test_encoding_round_trip_keeps_join_time():
    c = conn(7, 123.5)
    assert Conn.decode(c.encode()) == c
