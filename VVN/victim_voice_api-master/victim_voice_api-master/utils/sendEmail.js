import nodemailer from 'nodemailer';

let trnasporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.NODEMAILER_EMAIL,
        pass: process.env.NODEMAILER_PASSWORD,
    },
});

const sendOtpMail = (to, otp) => {
    const template = [`Your OTP is: ${otp}`].join('\n');

    return trnasporter.sendMail({
        from: process.env.NODEMAILER_FROM,
        to,
        subject: `Ceramic OTP`,
        text: template,
    });
};

const sendMail = (to, subject, text) => {
    return trnasporter.sendMail({
        from: process.env.NODEMAILER_FROM,
        to,
        subject,
        text,
    });
};

export { sendOtpMail, sendMail };
