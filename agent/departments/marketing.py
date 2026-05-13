"""Marketing department agent for Charles.

Writes copy, generates images and video, posts to social, runs launches.
One idea per asset. The brand is a feeling — every word and pixel either
reinforces it or gets cut.
"""

from __future__ import annotations

from departments._base import BaseDepartmentAgent
from tools.marketing.linkedin import (
    linkedin_get_recent_posts,
    linkedin_post,
)
from tools.marketing.loops import (
    loops_find_contact,
    loops_send_event,
    loops_send_transactional,
    loops_upsert_contact,
)
from tools.marketing.openai_images import (
    openai_edit_image,
    openai_generate_image,
)
from tools.marketing.replicate import (
    replicate_generate_image,
    replicate_generate_video,
    replicate_get_prediction,
)
from tools.marketing.twitter import (
    twitter_get_account_metrics,
    twitter_get_recent_tweets,
    twitter_post_tweet,
)


class MarketingAgent(BaseDepartmentAgent):
    department = "marketing"
    department_name = "Marketing"

    def get_department_tools(self) -> list:
        return [
            # Image / video generation
            replicate_generate_image,
            replicate_generate_video,
            replicate_get_prediction,
            openai_generate_image,
            openai_edit_image,
            # Social
            twitter_post_tweet,
            twitter_get_recent_tweets,
            twitter_get_account_metrics,
            linkedin_post,
            linkedin_get_recent_posts,
            # Lifecycle email
            loops_send_transactional,
            loops_send_event,
            loops_upsert_contact,
            loops_find_contact,
        ]
