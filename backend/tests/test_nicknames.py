import random

from daypage.nicknames import ADJECTIVES, MEMBER_COLORS, NOUNS, pick_color, pick_nickname


def test_word_lists_have_forty_unique_words_each():
    assert len(ADJECTIVES) == len(set(ADJECTIVES)) == 40
    assert len(NOUNS) == len(set(NOUNS)) == 40


def test_nickname_is_adjective_plus_noun():
    adjective, noun = pick_nickname(set(), random.Random(1)).rsplit(" ", 1)
    assert adjective in ADJECTIVES
    assert noun in NOUNS


def test_nickname_avoids_used_ones_even_when_one_combination_is_left():
    every = {f"{a} {n}" for a in ADJECTIVES for n in NOUNS}
    last = "졸린 수달"
    used = every - {last}
    assert pick_nickname(used, random.Random(7)) == last


def test_nickname_still_unique_after_all_combinations_are_used():
    every = {f"{a} {n}" for a in ADJECTIVES for n in NOUNS}
    nickname = pick_nickname(every, random.Random(3))
    assert nickname not in every


def test_color_prefers_least_used():
    used = MEMBER_COLORS[:-1]
    assert pick_color(used, random.Random(1)) == MEMBER_COLORS[-1]
