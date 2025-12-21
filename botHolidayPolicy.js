import { App } from "@slack/bolt";
import "dotenv/config";
import axios from "axios";
import { JSDOM } from "jsdom";

const COMPANY_POLICY_URL ="https://resources.workable.com/company-holiday-policy";
const FAILED_TEXT = "Unable to retrieve policy.";
const WELCOME_MESSAGE ="Hello! I'm your holiday policy assistant. Ask me anything about our company's holiday policy.";

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  appToken: process.env.SLACK_APP_TOKEN,
  socketMode: true,
});

const deepseekApiKey = process.env.DEEPSEEK_API_KEY;

async function fetchCompanyPolicy() {
  try {
    const response = await axios.get(COMPANY_POLICY_URL, {
      timeout: 10000,
      headers: { "User-Agent": "Mozilla/5.0" },
    });

    const dom = new JSDOM(response.data);
    const { document } = dom.window;
    document
      .querySelectorAll("script, style, nav, footer, header")
      .forEach((el) => el.remove());

    const text = document.body.textContent.replace(/\s+/g, " ").trim();
    return text.substring(0, 5000);
  } catch (error) {
    return FAILED_TEXT;
  }
}

let websiteContent = "";

async function queryDeepSeek(question) {
  try {
    if (!websiteContent || websiteContent.includes(FAILED_TEXT)) {
      websiteContent = await fetchCompanyPolicy();
    }

    const response = await axios.post(
      "https://api.deepseek.com/v1/chat/completions",
      {
        model: "deepseek-chat",
        messages: [
          {
            role: "system",
            content: `You are an HR assistant. Answer based only on this company policy: ${websiteContent} 
                     If info is not in the policy, say: "I cannot find that information." 
                     Answer in English. Only answer holiday policy questions.`,
          },
          {
            role: "user",
            content: question,
          },
        ],
        max_tokens: 800,
      },
      {
        headers: {
          Authorization: `Bearer ${deepseekApiKey}`,
          "Content-Type": "application/json",
        },
        timeout: 20000,
      }
    );
    return response.data.choices[0].message.content;
  } catch (error) {
    return "Sorry, I couldn't get an answer. Please try again later.";
  }
}

app.event("message", async ({ event, client }) => {
  try {
    if (!event.text) return;
    if (event.subtype === "bot_message" || event.bot_id) return;
    if (event.channel_type === "im") {
      const question = event.text.trim();
      if (!question) {
        await client.chat.postMessage({
          channel: event.channel,
          text: WELCOME_MESSAGE,
          thread_ts: event.thread_ts,
        });
        return;
      }

      const answer = await queryDeepSeek(question);
      await client.chat.postMessage({
        channel: event.channel,
        text: answer,
        thread_ts: event.thread_ts,
      });
    }
  } catch (error) {
    console.error("Error processing message:", error);
  }
});

app.event("app_mention", async ({ event, client }) => {
  try {
    const question = event.text.replace(/<@[^>]+>/g, "").trim();

    if (!question) {
      await client.chat.postMessage({
        channel: event.channel,
        text: WELCOME_MESSAGE,
        thread_ts: event.thread_ts,
      });
      return;
    }

    const answer = await queryDeepSeek(question);
    await client.chat.postMessage({
      channel: event.channel,
      text: answer,
      thread_ts: event.thread_ts,
    });
  } catch (error) {
    console.error("Error processing app_mention:", error);
  }
});

setInterval(async () => {
  try {
    const newContent = await fetchCompanyPolicy();
    if (!newContent.includes(FAILED_TEXT)) {
      websiteContent = newContent;
    }
  } catch (error) {
    console.error("Failed to refresh website content:", error.message);
  }
}, 6 * 60 * 60 * 1000);

async function start() {
  try {
    await app.start();
    console.log("App is running");
  } catch (error) {
    console.error("Failed to start app", error);
  }
}
start();
