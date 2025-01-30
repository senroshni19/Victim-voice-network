const twilio = require('twilio');

const client = new twilio(
    process.env.TWILIO_ACCOUNT_SID,  // Replace with your Twilio Account SID
    process.env.TWILIO_AUTH_TOKEN   // Replace with your Twilio Auth Token
);

const sendMessage = async (message, number) => {
    try {
        const messageResponse = await client.messages.create({
            body: message,
            messagingServiceSid: process.env.TWILIO_MESSAGE_SERVICE_ID,
            to: number,
        });

        if (messageResponse.status.toLowerCase() === 'accepted') {
            return {
                status: messageResponse.status,
                message: 'Message sent successfully',
                code: 200,
                body: messageResponse.body,
                to: messageResponse.to,
                dateUpdated: messageResponse.dateUpdated,
                dateCreated: messageResponse.dateCreated,
            };
        }
    } catch (error) {
        return {
            status: 'error',
            code: error.status,
            message: 'Message not sent',
            twilioErrorCode: error.code,
            errorInfoLink: error.moreInfo,
        };
    }
};

module.exports = { sendMessage };
