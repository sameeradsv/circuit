from app.behavioral import record_completion_rate


def test_record_completion_rate_default():
    assert record_completion_rate(None) == 0.7 * 0.7 + 0.3  # 0.79


def test_record_completion_rate_caps_at_one():
    assert record_completion_rate(1.0) == 1.0


def test_record_completion_rate_steps_up():
    rate = 0.7
    rate = record_completion_rate(rate)
    assert abs(rate - 0.79) < 1e-9
    rate = record_completion_rate(rate)
    assert abs(rate - 0.853) < 1e-9
